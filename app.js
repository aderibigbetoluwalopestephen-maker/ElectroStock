(() => {
  const $ = (id) => document.getElementById(id);
  const config = window.ELECTROSTOCK_CONFIG || {};
  const configured = config.supabaseUrl && config.supabaseAnonKey &&
    !config.supabaseUrl.includes("YOUR_") && !config.supabaseAnonKey.includes("YOUR_");
  let supabase = null, session = null, products = [], movements = [], sales = [], posCart = [], localMode = !configured;
  let currentRole="owner";
  const attendanceTokenFromUrl = new URLSearchParams(window.location.search).get("attendance");
  let attendanceQrToken = null, attendanceQrStoreId = null, attendanceActionInProgress = false;
  let proSubscription = {active:false, expires_at:null, error:null};
  let teamDataInitialized=false, notificationRefreshInProgress=false;
  let isPlatformAdmin=false;
  let supportTickets=[], supportMessages=[], activeSupportTicketId=null, isSupportAdmin=false;
  let paystackLoadPromise=null;
  // Capture the Pro button click early so unrelated page initialization errors
  // cannot leave the subscription button without a working handler.
  document.addEventListener("click",async(event)=>{
    const button=event.target?.closest?.("#subscribeLogoBtn");
    if(!button)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(button.dataset.checkoutBusy==="1")return;
    const status=$("proSubscriptionStatus");
    const originalText="Upgrade to Pro · ₦5,000/month";
    const setStatus=(message)=>{if(status)status.textContent=message;};
    const setBusy=(busy)=>{
      button.dataset.checkoutBusy=busy?"1":"0";
      button.disabled=busy;
      button.textContent=busy?"Preparing secure checkout…":(hasActiveProSubscription()?"Pro subscription active":originalText);
    };
    if(localMode||!session?.user?.id){
      setStatus("Please sign in with your Store Owner account to subscribe to ElectroStock Pro.");
      toast("Sign in to subscribe to ElectroStock Pro.");
      return;
    }
    if(currentRole!=="owner"){
      setStatus("Only the Store Owner can purchase ElectroStock Pro.");
      toast("Ask the Store Owner to upgrade this store.");
      return;
    }
    if(hasActiveProSubscription()){
      setStatus("ElectroStock Pro is already active.");
      toast("ElectroStock Pro is already active.");
      return;
    }
    if(!config.paystackPublicKey||!config.paystackProPlanCode){
      setStatus("Paystack is not configured. Check the public key and Pro plan code in config.js.");
      toast("Payment checkout is not configured.");
      return;
    }
    setBusy(true);
    try{
      if(!window.PaystackPop?.setup){
        if(!paystackLoadPromise){
          paystackLoadPromise=new Promise((resolve,reject)=>{
            const script=document.createElement("script");
            script.src="https://js.paystack.co/v1/inline.js";
            script.async=true;
            script.onload=()=>window.PaystackPop?.setup?resolve():reject(new Error("Paystack checkout library did not initialize."));
            script.onerror=()=>reject(new Error("Paystack checkout could not load. Check your internet connection or browser content blocker."));
            document.head.appendChild(script);
          }).finally(()=>{paystackLoadPromise=null;});
        }
        await paystackLoadPromise;
      }
      if(!window.PaystackPop?.setup)throw new Error("Paystack checkout is unavailable in this browser.");
      const handler=window.PaystackPop.setup({
        key:config.paystackPublicKey,
        email:session.user.email,
        currency:"NGN",
        plan:config.paystackProPlanCode,
        ref:"ESP_"+session.user.id.replace(/-/g,"")+"_"+Date.now(),
        metadata:{feature:"electrostock_pro",owner_id:session.user.id,plan_code:config.paystackProPlanCode},
        callback:function(response){
          (async()=>{
          setStatus("Payment received. Verifying securely…");
          try{
            if(!response?.reference)throw new Error("Paystack did not return a payment reference.");
            const result=await supabase.functions.invoke("verify-pro-subscription",{body:{reference:response.reference}});
            if(result.error)throw new Error(result.error.message||"Payment verification failed.");
            if(result.data?.error)throw new Error(result.data.error);
            if(!result.data?.active||!result.data?.expires_at)throw new Error("The server has not confirmed Pro activation yet.");
            proSubscription={active:true,expires_at:result.data.expires_at,error:null};
            await loadCloud({silent:true});
            setStatus("Payment verified. ElectroStock Pro is active until "+new Date(result.data.expires_at).toLocaleDateString("en-NG",{day:"numeric",month:"short",year:"numeric"})+".");
            toast("ElectroStock Pro activated successfully.");
          }catch(error){
            console.error("ElectroStock Pro payment verification failed:",error);
            setStatus("Payment may have succeeded, but verification needs attention. Do not pay again. Contact support with reference: "+(response?.reference||"not provided")+". Details: "+(error?.message||"Unknown error"));
            toast("Payment verification needs attention. Do not pay again.");
          }finally{setBusy(false);updateProSubscriptionUI();}
          })();
        },
        onClose:()=>{
          setBusy(false);
          if(!hasActiveProSubscription())setStatus("Checkout closed. No payment was confirmed.");
          updateProSubscriptionUI();
        }
      });
      if(!handler||typeof handler.openIframe!=="function")throw new Error("Paystack did not create a checkout session.");
      setStatus("Opening Paystack secure checkout…");
      handler.openIframe();
    }catch(error){
      console.error("ElectroStock Pro checkout could not start:",error);
      setBusy(false);
      setStatus(error?.message||"Checkout could not start. Refresh the page and try again.");
      toast(error?.message||"Payment checkout could not start.");
    }
  },true);
  const defaultSettings = {company_name:"ElectroStock", phone:"", email:"", address:"", currency:"NGN", logo_url:"", receipt_footer:"Thank you for your patronage!"};
  let companySettings = {...defaultSettings};
  const money = n => new Intl.NumberFormat("en",{style:"currency",currency:companySettings.currency||"NGN",maximumFractionDigits:2}).format(Number(n)||0);
  const fmtDate = d => new Date(d).toLocaleDateString("en-NG",{day:"numeric",month:"short",year:"numeric"});
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const statusOf = p => Number(p.quantity) <= 0 ? "out" : Number(p.quantity) <= Number(p.low_stock_threshold ?? 3) ? "low" : "in";
  const statusText = s => ({in:"In stock",low:"Low stock",out:"Out of stock"}[s]);
  const iconFor = cat => '<i class="fa-solid '+({Phones:"fa-mobile-screen",Laptops:"fa-laptop",Accessories:"fa-plug",Audio:"fa-headphones",Gaming:"fa-gamepad",Televisions:"fa-tv",Networking:"fa-wifi",Storage:"fa-hard-drive",Power:"fa-bolt",Electronics:"fa-microchip",Groceries:"fa-basket-shopping","Drinks and Beverages":"fa-glass-water","Food and Snacks":"fa-utensils","Household Items":"fa-house","Personal Care":"fa-pump-soap","Fashion and Clothing":"fa-shirt","Shoes and Bags":"fa-bag-shopping","Beauty and Cosmetics":"fa-wand-magic-sparkles","Health Products":"fa-kit-medical","Hardware and Building Materials":"fa-screwdriver-wrench","Stationery and Books":"fa-book","Automotive Parts":"fa-car"}[cat]||"fa-box")+'" aria-hidden="true"></i>';
  const localKey = "electrostock_demo_v1";
  function readLocal(){ try { const d=JSON.parse(localStorage.getItem(localKey)||"{}"); products=d.products||[]; movements=d.movements||[]; sales=d.sales||[]; companySettings={...defaultSettings,...(d.companySettings||{})}; } catch {products=[];movements=[];sales=[];companySettings={...defaultSettings};} }
  function saveLocal(){localStorage.setItem(localKey,JSON.stringify({products,movements,sales,companySettings}));}
  function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2800);}
  function authMessage(msg){$("authMessage").textContent=msg;}
  let authMode = "login";
  function setAuthMode(mode){
    authMode=mode;
    const signup=mode==="signup";
    $("authHeading").textContent=signup?"Create your account":"Welcome to ElectroStock";
    $("authSubtitle").textContent=signup?"Create a private workspace for your business.":"Sign in to manage your business inventory.";
    $("fullNameLabel").classList.toggle("hidden",!signup);$("fullName").disabled=!signup;$("fullName").required=signup;
    $("confirmPasswordLabel").classList.toggle("hidden",!signup);$("confirmPassword").disabled=!signup;$("confirmPassword").required=signup;
    $("password").autocomplete=signup?"new-password":"current-password";
    $("loginBtn").textContent=signup?"Create account":"Sign in";
    $("showSignup").textContent=signup?"Already have an account? Sign in":"Create an owner account";
    $("forgotPasswordBtn").classList.toggle("hidden",signup);
    authMessage("");
  }
  function showAuth(){ $("authScreen").classList.remove("hidden");$("app").classList.add("hidden");$("authBrandLogo").innerHTML='E<span>+</span>'; }
  function showApp(){
    $("authScreen").classList.add("hidden");$("app").classList.remove("hidden");
    const user=session?.user;const full=(user?.user_metadata?.full_name||"").trim();const email=user?.email||"Demo workspace";
    $("ownerDisplayName").textContent=full||email.split("@")[0]||"Store owner";$("ownerEmail").textContent=email;$("ownerAvatar").textContent=($("ownerDisplayName").textContent[0]||"O").toUpperCase();
    renderAll();applyCompanyBranding();populateSettingsForm();
  }
  function openOnboarding(){
    $("onboardingCompany").value=companySettings.company_name&&companySettings.company_name!=="ElectroStock"?companySettings.company_name:"";
    $("onboardingPhone").value=companySettings.phone||"";$("onboardingEmail").value=companySettings.email||session?.user?.email||"";$("onboardingAddress").value=companySettings.address||"";$("onboardingCurrency").value=companySettings.currency||"NGN";
    $("onboardingMessage").textContent="";$("onboardingModal").classList.remove("hidden");document.body.style.overflow="hidden";
  }
  function closeOnboarding(){ $("onboardingModal").classList.add("hidden");document.body.style.overflow=""; }
  function openPasswordReset(isInvite=false){$("resetPasswordMessage").textContent="";$("resetPasswordTitle").textContent=isInvite?"Set your ElectroStock password":"Choose a new password";$("saveNewPasswordBtn").textContent=isInvite?"Save password":"Update password";$("resetPasswordModal").classList.remove("hidden");document.body.style.overflow="hidden";}
  async function syncRealtimeAuth(activeSession=session){
    if(!supabase||localMode||!activeSession?.access_token||!supabase.realtime?.setAuth)return;
    try{await supabase.realtime.setAuth(activeSession.access_token);}
    catch(error){console.error("ElectroStock could not sync the signed-in session with Realtime:",error);}
  }
  async function init(){
    $("todayLabel").textContent=new Date().toLocaleDateString("en-NG",{weekday:"short",day:"numeric",month:"short",year:"numeric"});
    initializeMonthFilters();
    const callbackParams=new URLSearchParams(window.location.search);
    const callbackStatus=callbackParams.get("auth");
    const callbackError=callbackParams.get("error_description")||callbackParams.get("error");
    if(configured && window.supabase){
      const authStorage=window.localStorage;
      // Keep the standard Supabase project storage key so existing sessions remain
      // available after upgrades. Migrate sessions saved by the earlier custom key.
      try{
        authStorage.setItem("electrostock-storage-check","1");
        authStorage.removeItem("electrostock-storage-check");
        const projectRef=new URL(config.supabaseUrl).hostname.split(".")[0];
        const standardAuthKey="sb-"+projectRef+"-auth-token";
        const previousAuthKey="electrostock-auth-v1";
        if(!authStorage.getItem(standardAuthKey)&&authStorage.getItem(previousAuthKey)){
          authStorage.setItem(standardAuthKey,authStorage.getItem(previousAuthKey));
        }
      }catch(storageError){
        throw new Error("Browser storage is blocked. Allow site data/local storage for ElectroStock, then reload.");
      }
      supabase=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{
        auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true,storage:authStorage}
      });localMode=false;
      const {data:{session:s},error:sessionError}=await supabase.auth.getSession();
      if(sessionError)throw sessionError;
      session=s;
      await syncRealtimeAuth(session);
      supabase.auth.onAuthStateChange((event,s)=>{
        session=s;
        if(s?.access_token&&supabase.realtime?.setAuth)supabase.realtime.setAuth(s.access_token).catch(error=>console.error("ElectroStock Realtime session update failed:",error));
        if(event==="PASSWORD_RECOVERY"){openPasswordReset();return;}
        if(s){setTimeout(async()=>{await syncRealtimeAuth(s);showApp();await loadCloud();},0);}else if(event==="SIGNED_OUT"){showAuth();}
      });
      if(session){
        showApp();await loadCloud();
        if(callbackStatus==="invite"){openPasswordReset(true);}
        if(callbackStatus==="verified")toast("Email verified successfully. Welcome to ElectroStock.");
      }else{
        showAuth();
        if(callbackStatus==="verified"){setAuthMode("login");authMessage("Email verified successfully. Please sign in to continue.");}
        else if(callbackStatus==="invite"){authMessage("Invitation link did not create a session. Ask the store owner to send a new invitation, or use Forgot password? if you already accepted it.");}
        else if(callbackError){authMessage("Authentication link error: "+callbackError.replace(/\+/g," "));}
      }
      if(callbackStatus||callbackError){
        const cleanUrl=window.location.pathname;
        window.history.replaceState({},document.title,cleanUrl);
      }
    } else {
      localMode=true;readLocal();showAuth();authMessage("Demo mode: configure Supabase to enable real accounts and cloud sync.");
      $("showSignup").textContent="Open demo workspace";$("forgotPasswordBtn").classList.add("hidden");$("password").placeholder="Demo mode — any password";
    }
  }
  $("showSignup").addEventListener("click",async()=>{
    if(localMode){readLocal();showApp();toast("Demo workspace opened. Data stays in this browser.");return;}
    setAuthMode(authMode==="login"?"signup":"login");
  });
  $("loginForm").addEventListener("submit",async e=>{
    e.preventDefault();authMessage("");
    if(localMode){readLocal();showApp();toast("Demo workspace opened. Configure Supabase for secure accounts.");return;}
    const email=$("email").value.trim(),password=$("password").value;
    if(!localMode && (!supabase || !supabase.auth)) {
      try {
        if(configured && window.supabase && typeof window.supabase.createClient==="function") {
          supabase=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{
            auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true,storage:window.localStorage}
          });
        }
      } catch(initError) {
        console.error("ElectroStock Supabase client initialization failed:",initError);
      }
      if(!supabase || !supabase.auth) {
        authMessage("ElectroStock could not initialize secure sign-in. Refresh the page and try again. If this continues, check that the Supabase library and config.js are loading on the deployed site.");
        $("loginBtn").disabled=false;$("loginBtn").textContent="Sign in";
        return;
      }
    }
    if(authMode==="signup"){
      const fullName=$("fullName").value.trim();
      if(!fullName){authMessage("Enter your full name.");return;}
      if(password!==$("confirmPassword").value){authMessage("The passwords do not match.");return;}
      $("loginBtn").disabled=true;$("loginBtn").textContent="Creating account…";
      const {data,error}=await supabase.auth.signUp({email,password,options:{data:{full_name:fullName}}});
      $("loginBtn").disabled=false;$("loginBtn").textContent="Create account";
      if(error){authMessage(error.message);return;}
      if(data.session){session=data.session;showApp();await loadCloud();}
      else {setAuthMode("login");$("email").value=email;authMessage("Account created. If you are still asked to verify your email, the Owner must turn off Confirm email in Supabase Authentication settings before new users can sign in directly.");}
      return;
    }
    $("loginBtn").disabled=true;$("loginBtn").textContent="Signing in…";
    try {
      const {data,error}=await supabase.auth.signInWithPassword({email,password});
      if(error){authMessage(error.message);return;}
      session=data.session;showApp();await loadCloud();
    } catch(error) {
      console.error("ElectroStock sign-in failed:",error);
      authMessage("Sign-in could not complete. Check your internet connection and try again. "+(error?.message||"Please try again."));
    } finally {
      $("loginBtn").disabled=false;
      $("loginBtn").textContent=authMode==="signup"?"Create account":"Sign in";
    }
  });
  $("forgotPasswordBtn").addEventListener("click",async()=>{
    if(localMode){authMessage("Password recovery is available after connecting Supabase.");return;}
    const email=$("email").value.trim();if(!email){authMessage("Enter your email address first, then click Forgot password?");$("email").focus();return;}
    const btn=$("forgotPasswordBtn");btn.disabled=true;authMessage("Sending password reset email…");
    const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin});
    btn.disabled=false;authMessage(error?error.message:"If an account exists for that email, a password reset link has been sent. Check your inbox and spam folder.");
  });
  $("resetPasswordForm").addEventListener("submit",async e=>{
    e.preventDefault();const message=$("resetPasswordMessage"),btn=$("saveNewPasswordBtn"),password=$("newPassword").value;
    if(password!==$("confirmNewPassword").value){message.textContent="The passwords do not match.";return;}
    btn.disabled=true;btn.textContent="Updating…";
    const {error}=await supabase.auth.updateUser({password});
    btn.disabled=false;btn.textContent="Update password";
    if(error){message.textContent=error.message;return;}
    $("resetPasswordModal").classList.add("hidden");document.body.style.overflow="";$("resetPasswordForm").reset();toast("Password updated successfully.");
  });
  $("onboardingForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const msg=$("onboardingMessage"),btn=$("finishOnboardingBtn");
    msg.textContent="";
    const company_name=$("onboardingCompany").value.trim();
    if(!company_name){msg.textContent="Enter your business name to continue.";return;}
    if(!localMode&&(!supabase||!session?.user?.id)){
      msg.textContent="Your login session is missing or expired. Please sign out, sign in again, and retry.";
      return;
    }
    const next={company_name,phone:$("onboardingPhone").value.trim(),email:$("onboardingEmail").value.trim(),address:$("onboardingAddress").value.trim(),currency:$("onboardingCurrency").value,logo_url:"",receipt_footer:defaultSettings.receipt_footer};
    btn.disabled=true;btn.textContent="Saving…";
    try{
      if(localMode){
        companySettings={...defaultSettings,...next};saveLocal();
      }else{
        const {error}=await supabase.from("company_settings").upsert({...next,owner_id:session.user.id},{onConflict:"owner_id"});
        if(error){
          console.error("ElectroStock company setup save failed:",error);
          if(error.code==="42P01"||/relation .*company_settings.* does not exist/i.test(error.message)){
            throw new Error("The company settings table is missing. Open Supabase → SQL Editor and run supabase/company_settings_migration.sql from your GitHub repository.");
          }
          if(error.code==="42501"||/row-level security|permission denied/i.test(error.message)){
            throw new Error("Supabase blocked saving company details. Check that the company_settings migration and owner access policy have been applied.");
          }
          throw new Error(error.message||"Supabase could not save your company details.");
        }
        companySettings={...defaultSettings,...next};
      }
      closeOnboarding();applyCompanyBranding();populateSettingsForm();renderAll();switchView("dashboard");toast("Your business workspace is ready.");
    }catch(error){
      console.error("ElectroStock onboarding error:",error);
      msg.textContent=error?.message||"Something went wrong while saving. Please try again.";
    }finally{
      btn.disabled=false;btn.textContent="Save business and continue";
    }
  });
  $("logoutBtn").addEventListener("click",async()=>{stopTeamMessageNotifications();if(supabase&&!localMode)await supabase.auth.signOut();session=null;chatUnreadCount=0;seenChatMessageIds.clear();chatSeenInitialized=false;teamDataInitialized=false;updateChatBadge();showAuth();setAuthMode("login");});

  let activeAdminSection="overview";
  const adminDate=value=>value?new Date(value).toLocaleString("en-NG",{dateStyle:"medium",timeStyle:"short"}):"—";
  async function loadAdminSection(section=activeAdminSection){
    activeAdminSection=section;
    const titles={overview:["Platform overview","Live platform-wide totals and activity."],accounts:["Account management","Review registered users and manage application access."],subscriptions:["Subscription management","Manage ElectroStock Pro access and expiry dates."],support:["Customer support inbox","Review customer requests, reply and update ticket status."],audit:["Security and audit log","A traceable history of privileged platform actions."]};
    $("adminSectionTitle").textContent=titles[section]?.[0]||"Platform overview";
    $("adminSectionDescription").textContent=titles[section]?.[1]||"";
    document.querySelectorAll("[data-admin-section]").forEach(b=>b.classList.toggle("active",b.dataset.adminSection===section));
    const host=$("adminSectionContent");host.innerHTML='<p class="muted">Loading '+esc(section)+'…</p>';
    const {data,error}=await supabase.rpc("platform_admin_data",{p_section:section});
    if(error){host.innerHTML='<p class="form-message">Could not load this section: '+esc(error.message)+'</p>';return;}
    if(section==="overview"){
      host.innerHTML='<div class="admin-overview-message"><i class="fa-solid fa-shield-halved"></i><div><strong>Platform administration is active</strong><p>Use the tabs above to manage accounts, subscriptions, customer support and review administrator activity. Privileged actions are recorded in the audit log.</p></div></div>';
    }else if(section==="accounts"){
      const rows=data.accounts||[];
      host.innerHTML=rows.length?'<div class="table-wrap"><table class="admin-table"><thead><tr><th>Business / account</th><th>Email</th><th>Joined</th><th>Sales</th><th>Status</th><th>Action</th></tr></thead><tbody>'+rows.map(a=>'<tr><td><strong>'+esc(a.business_name)+'</strong><small>'+esc(a.user_id)+'</small></td><td>'+esc(a.email||"—")+'</td><td>'+esc(adminDate(a.created_at))+'</td><td>'+Number(a.sales_count||0).toLocaleString("en-NG")+'</td><td><span class="admin-status '+(a.status==="suspended"?"danger":"good")+'">'+esc(a.status||"active")+'</span>'+(a.suspension_reason?'<small>'+esc(a.suspension_reason)+'</small>':'')+'</td><td>'+(a.user_id===session?.user?.id?'<span class="muted">Your admin account</span>':a.status==="suspended"?'<button class="btn secondary small" data-admin-action="reactivate" data-user-id="'+esc(a.user_id)+'">Reactivate</button>':'<button class="btn danger small" data-admin-action="suspend" data-user-id="'+esc(a.user_id)+'">Suspend</button>')+'</td></tr>').join("")+'</tbody></table></div>':'<p class="muted">No registered accounts found.</p>';
    }else if(section==="subscriptions"){
      const rows=data.subscriptions||[];
      host.innerHTML=rows.length?'<div class="table-wrap"><table class="admin-table"><thead><tr><th>Business / account</th><th>Status</th><th>Expiry date</th><th>Actions</th></tr></thead><tbody>'+rows.map(s=>'<tr data-sub-row="'+esc(s.user_id)+'"><td><strong>'+esc(s.business_name)+'</strong><small>'+esc(s.email||"")+'</small></td><td><select class="admin-select" data-sub-status><option value="active" '+(s.status==="active"?"selected":"")+'>Active</option><option value="inactive" '+(s.status==="inactive"?"selected":"")+'>Inactive</option><option value="cancelled" '+(s.status==="cancelled"?"selected":"")+'>Cancelled</option><option value="expired" '+(s.status==="expired"?"selected":"")+'>Expired</option></select></td><td><input type="date" class="admin-date" data-sub-expiry value="'+(s.expires_at?new Date(s.expires_at).toISOString().slice(0,10):"")+'"></td><td><button class="btn primary small" data-admin-action="grant-subscription" data-user-id="'+esc(s.user_id)+'">Grant 30 days Pro</button> <button class="btn secondary small" data-admin-action="save-subscription" data-user-id="'+esc(s.user_id)+'">Save</button></td></tr>').join("")+'</tbody></table></div>':'<p class="muted">No registered accounts are available.</p>';
    }else if(section==="support"){
      const rows=data.tickets||[];
      host.innerHTML=rows.length?'<div class="admin-ticket-list">'+rows.map(t=>'<article class="admin-ticket"><div class="admin-ticket-head"><div><strong>'+esc(t.subject)+'</strong><p>'+esc(t.business_name)+' · '+esc(t.email||"")+'</p></div><span class="admin-status '+(t.status==="resolved"?"good":"pending")+'">'+esc(t.status)+'</span></div><div class="admin-ticket-meta">'+esc(t.category)+' · '+esc(t.priority)+' priority · Updated '+esc(adminDate(t.updated_at))+'</div><div class="admin-ticket-controls"><select class="admin-select" data-ticket-status="'+esc(t.id)+'"><option value="open" '+(t.status==="open"?"selected":"")+'>Open</option><option value="in_progress" '+(t.status==="in_progress"?"selected":"")+'>In progress</option><option value="resolved" '+(t.status==="resolved"?"selected":"")+'>Resolved</option></select><button class="btn primary small" data-admin-action="reply-ticket" data-ticket-id="'+esc(t.id)+'">View conversation / Reply</button></div></article>').join("")+'</div>':'<p class="muted">No support tickets found. If Support Centre has not been enabled in Supabase, apply its support migration first.</p>';
    }else if(section==="audit"){
      const rows=data.logs||[];
      host.innerHTML=rows.length?'<div class="table-wrap"><table class="admin-table"><thead><tr><th>Time</th><th>Administrator</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>'+rows.map(l=>'<tr><td>'+esc(adminDate(l.created_at))+'</td><td>'+esc(l.admin_email||"—")+'</td><td><strong>'+esc(l.action)+'</strong></td><td>'+esc(l.target_user_id||l.target_record_id||"—")+'</td><td>'+esc(JSON.stringify(l.details||{}))+'</td></tr>').join("")+'</tbody></table></div>':'<p class="muted">No administrator actions have been recorded yet.</p>';
    }
    $("adminDashboardMessage").textContent="";
  }
  async function loadSuperAdminDashboard(){
    if(!isPlatformAdmin||!supabase||localMode)return;
    const message=$("adminDashboardMessage");message.textContent="Loading secure platform metrics…";
    const {data,error}=await supabase.rpc("platform_admin_data",{p_section:"overview"});
    if(error){message.textContent="Platform administration migration is not applied yet: "+error.message;console.error("Super Admin overview failed:",error);return;}
    $("adminUserCount").textContent=Number(data?.registered_accounts||0).toLocaleString("en-NG");
    $("adminBusinessCount").textContent=Number(data?.businesses||0).toLocaleString("en-NG");
    $("adminSalesCount").textContent=Number(data?.sales_transactions||0).toLocaleString("en-NG");
    $("adminSupportCount").textContent=Number(data?.support_tickets||0).toLocaleString("en-NG");
    $("adminSalesVolume").textContent="Recorded volume: "+new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:0}).format(Number(data?.sales_volume||0));
    $("adminNewAccounts").textContent=Number(data?.new_accounts_30d||0).toLocaleString("en-NG");
    $("adminActiveSubs").textContent=Number(data?.active_subscriptions||0).toLocaleString("en-NG");
    $("adminSuspended").textContent=Number(data?.suspended_accounts||0).toLocaleString("en-NG");
    message.textContent="Metrics refreshed: "+new Date().toLocaleString("en-NG");
    await loadAdminSection(activeAdminSection);
  }
  document.querySelectorAll("[data-admin-section]").forEach(button=>button.addEventListener("click",()=>loadAdminSection(button.dataset.adminSection)));
  $("adminRefreshBtn").addEventListener("click",()=>loadSuperAdminDashboard());
  $("adminSectionContent").addEventListener("click",async event=>{
    const button=event.target.closest("[data-admin-action]");if(!button||!isPlatformAdmin)return;
    const action=button.dataset.adminAction;let payload={};
    if(action==="suspend"){
      if(!confirm("Suspend this account's access to ElectroStock?"))return;
      payload={user_id:button.dataset.userId,reason:prompt("Reason for suspension (optional):","")||""};
      button.disabled=true;
      const {error}=await supabase.rpc("platform_admin_action",{p_action:"suspend_account",p_payload:payload});
      if(error){toast("Could not suspend account: "+error.message);button.disabled=false;return;}
      toast("Account marked as suspended.");await loadAdminSection("accounts");await loadSuperAdminDashboard();
    }else if(action==="reactivate"){
      if(!confirm("Reactivate this account?"))return;
      button.disabled=true;
      const {error}=await supabase.rpc("platform_admin_action",{p_action:"reactivate_account",p_payload:{user_id:button.dataset.userId}});
      if(error){toast("Could not reactivate account: "+error.message);button.disabled=false;return;}
      toast("Account reactivated.");await loadAdminSection("accounts");await loadSuperAdminDashboard();
    }else if(action==="grant-subscription"){
      if(!confirm("Grant this business 30 days of ElectroStock Pro? This is a manual admin grant and does not process a payment."))return;
      button.disabled=true;
      const {error}=await supabase.rpc("platform_admin_action",{p_action:"grant_pro_subscription",p_payload:{user_id:button.dataset.userId}});
      if(error){toast("Could not grant Pro subscription: "+error.message);button.disabled=false;return;}
      toast("ElectroStock Pro granted for 30 days.");await loadAdminSection("subscriptions");await loadSuperAdminDashboard();
    }else if(action==="save-subscription"){
      const row=button.closest("[data-sub-row]");const status=row.querySelector("[data-sub-status]").value;const expiry=row.querySelector("[data-sub-expiry]").value;
      if(status==="active"&&!expiry){toast("Choose an expiry date before activating a subscription.");return;}
      if(!confirm("Save this subscription status and expiry date?"))return;
      button.disabled=true;
      const {error}=await supabase.rpc("platform_admin_action",{p_action:"update_subscription",p_payload:{user_id:button.dataset.userId,status,expires_at:expiry?expiry+"T23:59:59.999Z":null}});
      if(error){toast("Subscription update failed: "+error.message);button.disabled=false;return;}
      toast("Subscription record updated.");await loadAdminSection("subscriptions");await loadSuperAdminDashboard();
    }else if(action==="reply-ticket"){
      const ticketId=button.dataset.ticketId;
      const {data:messages,error:readError}=await supabase.from("support_ticket_messages").select("message,sender_id,created_at").eq("ticket_id",ticketId).order("created_at",{ascending:true}).limit(50);
      if(readError){toast("Could not load conversation: "+readError.message);return;}
      const history=(messages||[]).map(m=>adminDate(m.created_at)+" · "+(m.sender_id===session?.user?.id?"You":"Customer/staff")+": "+m.message).join("\n\n");
      const reply=prompt("Ticket conversation:\n\n"+(history||"No messages yet.")+"\n\nWrite your reply:");
      if(!reply?.trim())return;
      const status=document.querySelector('[data-ticket-status="'+ticketId+'"]')?.value||"in_progress";
      button.disabled=true;
      const {error}=await supabase.rpc("platform_admin_action",{p_action:"support_reply",p_payload:{ticket_id:ticketId,message:reply.trim(),status}});
      if(error){toast("Could not send reply: "+error.message);button.disabled=false;return;}
      toast("Support reply sent.");await loadAdminSection("support");await loadSuperAdminDashboard();
    }
  });
  async function checkPlatformAdmin(){
    isPlatformAdmin=false;$("superAdminNav").classList.add("hidden");
    if(localMode||!session?.user?.id)return;
    const {data,error}=await supabase.rpc("is_platform_admin");
    if(error){console.warn("Super Admin access check unavailable:",error.message);return;}
    isPlatformAdmin=data===true;
    $("superAdminNav").classList.toggle("hidden",!isPlatformAdmin);
    if(isPlatformAdmin){
      // Platform administrators use a separate workspace, not a store-owner workspace.
      document.querySelectorAll('.nav-item[data-view]').forEach(button=>{
        if(button.id!=="superAdminNav")button.classList.add("hidden");
      });
      $("superAdminNav").classList.remove("hidden");
      $("pageTitle").textContent="Super Admin";
      document.querySelector(".topbar-title .eyebrow").textContent="PLATFORM ADMINISTRATION";
      document.querySelector(".top-actions").classList.add("hidden");
    }else{
      document.querySelectorAll('.nav-item[data-view]').forEach(button=>button.classList.remove("hidden"));
      $("superAdminNav").classList.add("hidden");
      document.querySelector(".topbar-title .eyebrow").textContent="YOUR STORE AT A GLANCE";
      document.querySelector(".top-actions").classList.remove("hidden");
    }
    if(!isPlatformAdmin&&new URLSearchParams(location.search).get("admin")==="1")toast("This account is not authorised for Super Admin access.");
  }
  async function loadCloud(options={}){
    if(localMode||!session?.user?.id)return;
    await checkPlatformAdmin();
    if(isPlatformAdmin){
      closeOnboarding();
      companySettings={...defaultSettings,company_name:"ElectroStock Platform"};
      applyCompanyBranding();
      switchView("superadmin");
      return;
    }
    const suspensionCheck=await supabase.rpc("platform_admin_is_suspended");
    if(!suspensionCheck.error&&suspensionCheck.data===true){
      await supabase.auth.signOut();session=null;showAuth();
      authMessage("This ElectroStock account has been suspended. Contact support if you believe this is a mistake.");
      return;
    }
    teamOwnerId=session.user.id;currentRole="owner";
    const membership=await supabase.from("store_members").select("owner_id,role").eq("user_id",session.user.id).maybeSingle();
    if(membership.data){teamOwnerId=membership.data.owner_id;currentRole=membership.data.role||"sales_rep";}
    loadSavedNotifications();
    const [pr,mv,sv,cs,sub]=await Promise.all([
      supabase.from("products").select("*").order("created_at",{ascending:false}),
      supabase.from("stock_movements").select("*, products(name)").order("created_at",{ascending:false}).limit(300),
      supabase.from("sales").select("*").order("created_at",{ascending:false}).limit(1000),
      supabase.from("company_settings").select("*").eq("owner_id",teamOwnerId).maybeSingle(),
      supabase.from("pro_subscriptions").select("status,expires_at").eq("owner_id",teamOwnerId).maybeSingle()
    ]);
    if(pr.error){products=[];toast("Products could not load: "+pr.error.message);}else products=pr.data||[];
    if(mv.error){movements=[];toast("Stock movements could not load: "+mv.error.message);}else movements=(mv.data||[]).map(m=>({...m,product_name:m.products?.name||"Deleted product"}));
    if(sv.error){sales=[];toast("Sales history needs attention: "+sv.error.message);}else sales=sv.data||[];
    companySettings={...defaultSettings,...(cs?.data||{})};
    proSubscription={active:!sub?.error && sub?.data?.status==="active" && !!sub.data.expires_at && new Date(sub.data.expires_at)>new Date(),expires_at:sub?.data?.expires_at||null,error:sub?.error?.message||null};
    if(sub?.error)console.error("Pro subscription status could not be loaded:",sub.error.message);
    ensureDailySubscriptionReminder();
    ensureWeeklyAndMonthlyMessages();
    renderAll();applyCompanyBranding();populateSettingsForm();
    await loadTeamData();
    await handleAttendanceLink();
    if(cs?.error){console.error("Company settings could not be checked:",cs.error.message);}
    if(!options.silent && !cs?.data && session?.user?.id && currentRole==="owner"){openOnboarding();}
  }
  async function saveProduct(data,id){
    if(!canManageProducts())return {error:{message:"Sales reps cannot add or edit store products. Ask the owner or a manager."}};
    if(!id&&!hasActiveProSubscription()&&products.length>=50)return {error:{message:"Your Free plan includes up to 50 products. Upgrade to ElectroStock Pro for unlimited products."}};
    if(localMode){
      if(id){products=products.map(p=>p.id===id?{...p,...data,updated_at:new Date().toISOString()}:p);}
      else products.unshift({...data,id:crypto.randomUUID(),created_at:new Date().toISOString()});
      saveLocal();return {error:null};
    }
    const result=id?await supabase.from("products").update(data).eq("id",id).select().single():await supabase.from("products").insert({...data,owner_id:teamOwnerId||session.user.id}).select().single();
    return result;
  }
  async function deleteProduct(id){
    if(!canManageProducts()){toast("Sales reps cannot delete store products. Ask the owner or a manager.");return;}
    if(!confirm("Delete this product? Its stock movement history may also be removed."))return;
    if(localMode){products=products.filter(p=>p.id!==id);movements=movements.filter(m=>m.product_id!==id);saveLocal();}
    else {const {error}=await supabase.from("products").delete().eq("id",id);if(error){toast(error.message);return;}await loadCloud();}
    renderAll();toast("Product deleted.");
  }
  function renderAll(){renderStats();renderProducts();renderRecent();renderAlerts();renderProductOptions();renderMovements();renderSales();renderReports();renderPos();applyCompanyBranding();updateProFeatureAccess();}
  function renderStats(){
    const total=products.length,units=products.reduce((a,p)=>a+Number(p.quantity||0),0),value=products.reduce((a,p)=>a+Number(p.quantity||0)*Number(p.purchase_price||0),0);
    const low=products.filter(p=>statusOf(p)==="low").length,out=products.filter(p=>statusOf(p)==="out").length;
    $("totalProducts").textContent=total;$("totalUnits").textContent=units.toLocaleString("en-NG");$("inventoryValue").textContent=money(value);$("lowStockCount").textContent=low;
    $("productNavCount").textContent=total;$("snapshotCount").textContent=total;$("inStockCount").textContent=products.filter(p=>statusOf(p)==="in").length;$("snapshotLow").textContent=low;$("outStockCount").textContent=out;
    if($("salesNavCount"))$("salesNavCount").textContent=sales.length;
  }
  function productCell(p){return `<div class="table-product"><div class="product-thumb">${p.image_url?`<img src="${esc(p.image_url)}" alt="" onerror="this.style.display='none'">`:iconFor(p.category)}</div><div><strong>${esc(p.name)}</strong><small>${esc([p.brand,p.model].filter(Boolean).join(" · ")||p.category||"Product")}</small></div></div>`;}
  function statusBadge(p){const s=statusOf(p);return `<span class="status ${s}">${statusText(s)}</span>`;}
  function productRow(p,actions=true){return `<tr><td>${productCell(p)}</td><td>${esc(p.category||"Other")}</td><td>${money(p.purchase_price)}</td><td>${money(p.selling_price)}</td><td><strong>${Number(p.quantity)||0}</strong></td><td>${statusBadge(p)}</td>${actions?`<td><div class="row-actions"><button class="mini-btn" data-edit="${p.id}">Edit</button><button class="mini-btn" data-delete="${p.id}">Delete</button></div></td>`:""}</tr>`;}
  function renderProducts(){
    const query=($("searchInput").value||"").toLowerCase(),cat=$("categoryFilter").value,stock=$("stockFilter").value;
    const list=products.filter(p=>[p.name,p.brand,p.model,p.category].join(" ").toLowerCase().includes(query)&&(!cat||p.category===cat)&&(!stock||statusOf(p)===({in:"in",low:"low",out:"out"}[stock])));
    $("productsTable").innerHTML=list.map(p=>productRow(p,canManageProducts())).join("");$("emptyProducts").classList.toggle("hidden",list.length>0);
    $("addProductBtn").classList.toggle("hidden",!canManageProducts());$("emptyAddBtn").classList.toggle("hidden",!canManageProducts());
    $("importBtn").classList.toggle("hidden",!canManageProducts());$("addProductTop").classList.toggle("hidden",!canManageProducts());
    const cats=[...new Set(products.map(p=>p.category).filter(Boolean))].sort(),current=$("categoryFilter").value;
    $("categoryFilter").innerHTML='<option value="">All categories</option>'+cats.map(c=>`<option ${c===current?"selected":""}>${esc(c)}</option>`).join("");
    $("productsTable").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>openModal(b.dataset.edit)));
    $("productsTable").querySelectorAll("[data-delete]").forEach(b=>b.addEventListener("click",()=>deleteProduct(b.dataset.delete)));
  }
  function renderRecent(){const list=[...products].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,5);$("recentProducts").innerHTML=list.length?`<table><thead><tr><th>PRODUCT</th><th>SELL PRICE</th><th>QUANTITY</th><th>STATUS</th></tr></thead><tbody>${list.map(p=>`<tr><td>${productCell(p)}</td><td>${money(p.selling_price)}</td><td>${Number(p.quantity)||0}</td><td>${statusBadge(p)}</td></tr>`).join("")}</tbody></table>`:'<div class="empty-state"><div class="empty-icon">▤</div><h3>Your catalogue starts here</h3><p>Add your products to see them listed here.</p><button class="btn primary" id="recentAddBtn">＋ Add product</button></div>';const b=$("recentAddBtn");if(b&&!canManageProducts())b.classList.add("hidden");if(b)b.addEventListener("click",()=>openModal());}
  function renderAlerts(){const list=products.filter(p=>statusOf(p)!=="in").sort((a,b)=>Number(a.quantity)-Number(b.quantity)).slice(0,6);$("alertsList").innerHTML=list.length?list.map(p=>`<div class="alert-item"><div class="product-thumb">${p.image_url?`<img src="${esc(p.image_url)}" alt="">`:iconFor(p.category)}</div><div class="alert-info"><strong>${esc(p.name)}</strong><small>${esc(p.category||"Uncategorized")} · Reorder at ${Number(p.low_stock_threshold??3)}</small></div><span class="qty-badge ${statusOf(p)}">${statusOf(p)==="out"?"Out of stock":`${p.quantity} left`}</span></div>`).join(""):'<div class="empty-state"><div class="empty-icon">✓</div><h3>All clear</h3><p>No low-stock or out-of-stock alerts.</p></div>';}
  function renderProductOptions(){const current=$("stockProduct").value;$("stockProduct").innerHTML='<option value="">Select a product</option>'+products.map(p=>`<option value="${p.id}" ${p.id===current?"selected":""}>${esc(p.name)} (${p.quantity} available)</option>`).join("");}
  function currentMonthKey(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");}
  function monthMatches(value,month){if(!month)return true;const d=new Date(value||0);return !Number.isNaN(d.getTime())&&d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")===month;}
  function initializeMonthFilters(){const month=currentMonthKey();["salesMonthFilter","movementMonthFilter","attendanceMonthFilter","businessReportMonth"].forEach(id=>{const el=$(id);if(el&&!el.value)el.value=month;});}
  function renderMovements(){const month=$("movementMonthFilter")?.value||currentMonthKey();const monthly=movements.filter(m=>monthMatches(m.created_at,month));const added=monthly.filter(m=>Number(m.quantity_change)>0).reduce((sum,m)=>sum+Number(m.quantity_change),0);const sold=monthly.filter(m=>m.movement_type==="sale").reduce((sum,m)=>sum+Math.abs(Number(m.quantity_change)),0);const net=monthly.reduce((sum,m)=>sum+Number(m.quantity_change||0),0);$("monthlyStockAdded").textContent=added.toLocaleString("en-NG");$("monthlyStockSold").textContent=sold.toLocaleString("en-NG");$("monthlyStockNet").textContent=(net>0?"+":"")+net.toLocaleString("en-NG");const rows=monthly.slice(0,300);$("movementTable").innerHTML=rows.map(m=>`<tr><td>${fmtDate(m.created_at||new Date())}</td><td>${esc(m.product_name||products.find(p=>p.id===m.product_id)?.name||"Product")}</td><td>${esc(({purchase:"Purchase",adjustment:"Adjustment",sale:"Sale"}[m.movement_type]||m.movement_type||"Movement"))}</td><td style="color:${Number(m.quantity_change)>=0?"#78dfb4":"#ff9ba7"}">${Number(m.quantity_change)>0?"+":""}${Number(m.quantity_change)}</td><td>${esc(m.note||"—")}</td></tr>`).join("");$("emptyMovements").classList.toggle("hidden",rows.length>0);}

  let teamMembers=[],teamMessages=[],teamAnnouncements=[],attendanceRows=[],teamOwnerId=null;
  let teamMessageChannel=null,chatUnreadCount=0,chatSeenInitialized=false;
  const seenChatMessageIds=new Set();

  let callInboxChannel=null,callPairChannel=null,activeCall=null,incomingCall=null,localCallStream=null,callPeerConnection=null,callMicMuted=false,callCameraOff=false,callRemoteStream=null,callTimerInterval=null,callStartedAt=null,callRingTimeout=null;
  let ringtoneAudioContext=null,ringtoneInterval=null,ringtoneNodes=[];
  function stopIncomingRingtone(){
    if(ringtoneInterval){clearInterval(ringtoneInterval);ringtoneInterval=null;}
    ringtoneNodes.forEach(node=>{try{node.stop();}catch{}});
    ringtoneNodes=[];
  }
  function playRingtoneBurst(){
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;
    if(!AudioContextClass)return;
    try{
      if(!ringtoneAudioContext)ringtoneAudioContext=new AudioContextClass();
      if(ringtoneAudioContext.state==="suspended")ringtoneAudioContext.resume().catch(()=>{});
      const ctx=ringtoneAudioContext;
      if(ctx.state!=="running")return;
      [[880,0],[660,0.22]].forEach(([frequency,delay])=>{
        const oscillator=ctx.createOscillator(),gain=ctx.createGain();
        oscillator.type="sine";oscillator.frequency.value=frequency;
        gain.gain.setValueAtTime(0.0001,ctx.currentTime+delay);
        gain.gain.exponentialRampToValueAtTime(0.12,ctx.currentTime+delay+0.025);
        gain.gain.setValueAtTime(0.12,ctx.currentTime+delay+0.16);
        gain.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+delay+0.23);
        oscillator.connect(gain);gain.connect(ctx.destination);
        oscillator.start(ctx.currentTime+delay);oscillator.stop(ctx.currentTime+delay+0.24);
        ringtoneNodes.push(oscillator);
        oscillator.onended=()=>{ringtoneNodes=ringtoneNodes.filter(node=>node!==oscillator);};
      });
    }catch(error){console.warn("Incoming call ringtone could not play:",error);}
  }
  function startIncomingRingtone(){
    stopIncomingRingtone();playRingtoneBurst();
    ringtoneInterval=setInterval(()=>{if(incomingCall&&!activeCall)playRingtoneBurst();else stopIncomingRingtone();},1800);
  }
  // Prepare audio after the first user interaction so browser autoplay rules are less likely to block ringing.
  function primeCallAudio(){
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;
    if(!AudioContextClass||ringtoneAudioContext)return;
    try{ringtoneAudioContext=new AudioContextClass();if(ringtoneAudioContext.state==="suspended")ringtoneAudioContext.resume().catch(()=>{});}catch{}
    document.removeEventListener("pointerdown",primeCallAudio);
    document.removeEventListener("keydown",primeCallAudio);
  }
  document.addEventListener("pointerdown",primeCallAudio,{once:true});
  document.addEventListener("keydown",primeCallAudio,{once:true});
  function clearCallRingTimeout(){if(callRingTimeout){clearTimeout(callRingTimeout);callRingTimeout=null;}}
  function callPanelOpen(){const panel=$("teamCallPanel");panel.classList.remove("hidden");panel.classList.add("is-open");}
  function closeCallPanel(){if(incomingCall&&!activeCall){rejectIncomingCall();return;}const panel=$("teamCallPanel");panel.classList.add("hidden");panel.classList.remove("is-open");}
  function callMemberName(userId){if(userId===teamOwnerId)return (session?.user?.user_metadata?.full_name||"Store Owner");const member=teamMembers.find(m=>m.user_id===userId);return member?.display_name||"Team member";}
  function refreshCallContacts(){
    const select=$("callContactSelect");if(!select)return;const previous=select.value;const options=[];
    if(currentRole!=="owner"&&teamOwnerId&&teamOwnerId!==session?.user?.id)options.push({id:teamOwnerId,name:"Store Owner"});
    teamMembers.filter(m=>m.active!==false&&m.user_id&&m.user_id!==session?.user?.id).forEach(m=>options.push({id:m.user_id,name:m.display_name+" ("+(m.role==="manager"?"Manager":"Sales Rep")+")"}));
    select.innerHTML='<option value="">Choose a team member</option>'+options.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name)+'</option>').join("");
    if(options.some(m=>m.id===previous))select.value=previous;
    const allowed=!localMode&&!!supabase&&!!session?.user?.id&&!!teamOwnerId;
    $("startAudioCallBtn").disabled=!allowed||options.length===0;$("startVideoCallBtn").disabled=!allowed||options.length===0;
    $("startAudioCallFromChat").disabled=!allowed||options.length===0;$("startVideoCallFromChat").disabled=!allowed||options.length===0;
  }
  function showCallError(message){$("callErrorMessage").textContent=message||"";}
  function callTopic(a,b){return "electrostock-call:"+teamOwnerId+":"+[a,b].sort().join(":");}
  function callUserTopic(userId){return "electrostock-call-user:"+teamOwnerId+":"+userId;}
  async function waitForCallChannel(channel){
    return new Promise((resolve,reject)=>{let done=false;channel.subscribe((status,err)=>{if(done)return;if(status==="SUBSCRIBED"){done=true;resolve(channel);}else if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"||status==="CLOSED"){done=true;console.error("ElectroStock secure calling channel failed:",status,err||null);const detail=err?.message||err?.reason||err?.code||"";reject(new Error("Secure calling channel could not connect ("+status+")"+(detail?": "+detail:"")+". Check the Supabase Realtime authorization settings and calling policies."));}});});
  }
  async function broadcastToChannel(channel,event,payload){
    if(!channel)throw new Error("The secure call connection is not ready.");
    const result=await channel.send({type:"broadcast",event,payload});
    if(result!=="ok")throw new Error("The call signal could not be sent. Check the Supabase calling policies and try again.");
  }
  async function sendCallInvite(targetId,payload){
    const channel=supabase.channel(callUserTopic(targetId),{config:{private:true}});
    try{await waitForCallChannel(channel);await broadcastToChannel(channel,payload.type==="call-state"?"call-state":"call-invite",payload);}
    finally{await supabase.removeChannel(channel);}
  }
  function startTeamCallNotifications(){
    if(callInboxChannel&&supabase){supabase.removeChannel(callInboxChannel);callInboxChannel=null;}
    if(localMode||!supabase||!session?.user?.id||!teamOwnerId)return;
    callInboxChannel=supabase.channel(callUserTopic(session.user.id),{config:{private:true}})
      .on("broadcast",{event:"call-state"},message=>{const data=message.payload;if(data?.type!=="call-state"||data.toId!==session?.user?.id)return;if(data.state==="rejected"&&data.callId===activeCall?.callId){clearCallRingTimeout();showCallError(data.reason==="busy"?"The team member is already on another call.":"The team member declined the call.");cleanupTeamCall(false);}else if(data.state==="no-answer"&&data.callId===activeCall?.callId){clearCallRingTimeout();addNotification("Call not answered · "+callMemberName(activeCall.toId),"Your "+(activeCall.mode==="video"?"video":"audio")+" call was not answered.","call");showCallError("No answer. A missed-call notification was saved.");cleanupTeamCall(false);}})
      .on("broadcast",{event:"call-invite"},message=>{
        const invite=message.payload;
        if(!invite||invite.toId!==session?.user?.id||invite.ownerId!==teamOwnerId||!invite.callId)return;
        if(activeCall||incomingCall){sendCallInvite(invite.fromId,{type:"call-state",ownerId:teamOwnerId,callId:invite.callId,fromId:session.user.id,toId:invite.fromId,state:"rejected",reason:"busy"}).catch(()=>{});return;}
        incomingCall=invite;clearCallRingTimeout();callPanelOpen();$("callSetupArea").classList.add("hidden");$("activeCallArea").classList.add("hidden");$("incomingCallArea").classList.remove("hidden");startIncomingRingtone();
        $("incomingCallName").textContent=invite.fromName||callMemberName(invite.fromId);$("incomingCallDetails").textContent=(invite.mode==="video"?"Incoming video call":"Incoming audio call")+" · "+$("incomingCallName").textContent;
        $("callStatusText").textContent="Incoming "+(invite.mode==="video"?"video":"audio")+" call";showCallError("");
        toast("Incoming "+(invite.mode==="video"?"video":"audio")+" call from "+(invite.fromName||"your team"));
        sendBrowserNotification("Incoming call · "+(invite.fromName||"Team member"),"Open ElectroStock to answer the "+invite.mode+" call.","electrostock-call-"+invite.callId);
        callRingTimeout=setTimeout(()=>{if(!incomingCall||incomingCall.callId!==invite.callId)return;stopIncomingRingtone();incomingCall=null;$("incomingCallArea").classList.add("hidden");$("callSetupArea").classList.remove("hidden");$("callStatusText").textContent="Missed call";const who=invite.fromName||callMemberName(invite.fromId);const body="You missed an "+(invite.mode==="video"?"video":"audio")+" call from "+who+".";addNotification("Missed call · "+who,body,"call");toast(body);sendBrowserNotification("Missed call · "+who,body,"electrostock-missed-call-"+invite.callId);},30000);
      }).subscribe(status=>{if(status==="CHANNEL_ERROR"||status==="TIMED_OUT")console.warn("ElectroStock calling inbox channel:",status);});
  }
  async function startPairCallChannel(){
    if(callPairChannel&&supabase){await supabase.removeChannel(callPairChannel);callPairChannel=null;}
    const topic=callTopic(activeCall.fromId,activeCall.toId);
    const channel=supabase.channel(topic,{config:{private:true}})
      .on("broadcast",{event:"call-state"},async message=>{
        const data=message.payload;if(!data||data.callId!==activeCall?.callId||data.senderId===session?.user?.id)return;
        if(data.state==="accepted"&&activeCall?.caller){clearCallRingTimeout();try{await createCallOffer();}catch(error){showCallError(error?.message||"Could not start the call.");endTeamCall(true);}}
        else if(data.state==="rejected"){showCallError((callMemberName(activeCall.toId))+" declined the call.");cleanupTeamCall(false);}
        else if(data.state==="ended"){cleanupTeamCall(false);}
      })
      .on("broadcast",{event:"call-signal"},async message=>{
        const data=message.payload;if(!data||data.callId!==activeCall?.callId||data.senderId===session?.user?.id||data.targetId!==session?.user?.id)return;
        try{
          if(data.signalType==="offer"&&!activeCall.caller){
            await ensureCallMedia();await ensurePeerConnection();await callPeerConnection.setRemoteDescription(new RTCSessionDescription(data.description));
            const answer=await callPeerConnection.createAnswer();await callPeerConnection.setLocalDescription(answer);
            await sendPairCallSignal("answer",{description:callPeerConnection.localDescription});
            setCallActiveUI();
          }else if(data.signalType==="answer"&&activeCall.caller){
            await callPeerConnection.setRemoteDescription(new RTCSessionDescription(data.description));setCallActiveUI();
          }else if(data.signalType==="ice"&&data.candidate&&callPeerConnection){
            try{await callPeerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));}catch(iceError){console.warn("Ignoring late ICE candidate",iceError);}
          }
        }catch(error){showCallError(error?.message||"The call connection failed.");}
      });
    await waitForCallChannel(channel);callPairChannel=channel;
  }
  async function sendPairCallSignal(signalType,extra={}){
    if(!activeCall||!callPairChannel)return;
    await broadcastToChannel(callPairChannel,"call-signal",{callId:activeCall.callId,senderId:session.user.id,targetId:activeCall.caller?activeCall.toId:activeCall.fromId,signalType,...extra});
  }
  async function sendPairCallState(state,extra={}){
    if(!activeCall||!callPairChannel)return;
    await broadcastToChannel(callPairChannel,"call-state",{callId:activeCall.callId,senderId:session.user.id,state,...extra});
  }
  async function ensureCallMedia(){
    if(localCallStream)return localCallStream;
    if(!navigator.mediaDevices?.getUserMedia)throw new Error("Your browser does not support microphone/camera access. Open ElectroStock in an updated browser over HTTPS.");
    try{
      const wantsVideo=activeCall?.mode==="video";
      localCallStream=await navigator.mediaDevices.getUserMedia({
        audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
        video:wantsVideo?{width:{ideal:640,max:640},height:{ideal:360,max:480},frameRate:{ideal:20,max:24},facingMode:"user"}:false
      });
    }
    catch(error){throw new Error(error?.name==="NotAllowedError"?"Allow microphone"+(activeCall?.mode==="video"?" and camera":"")+" access in your browser to make this call.":error?.message||"Could not access your microphone or camera.");}
    $("localCallVideo").srcObject=localCallStream;$("localCallVideo").classList.toggle("audio-only",activeCall?.mode!=="video");
    $("toggleCallCameraBtn").classList.toggle("hidden",activeCall?.mode!=="video");
    return localCallStream;
  }
  async function ensurePeerConnection(){
    if(callPeerConnection)return callPeerConnection;
    const stream=await ensureCallMedia();
    callRemoteStream=new MediaStream();
    callPeerConnection=new RTCPeerConnection({
      iceServers:[
        {urls:"stun:stun.l.google.com:19302"},
        {urls:"stun:stun.cloudflare.com:3478"}
      ],
      bundlePolicy:"max-bundle",
      rtcpMuxPolicy:"require",
      iceCandidatePoolSize:6
    });
    stream.getTracks().forEach(track=>callPeerConnection.addTrack(track,stream));
    // Keep video bitrate modest so calls remain usable on slower mobile networks.
    if(activeCall?.mode==="video"){
      callPeerConnection.getSenders().filter(sender=>sender.track?.kind==="video").forEach(async sender=>{
        try{
          const params=sender.getParameters();
          params.encodings=params.encodings?.length?params.encodings:[{}];
          params.encodings[0].maxBitrate=550000;
          params.encodings[0].maxFramerate=20;
          params.degradationPreference="maintain-framerate";
          await sender.setParameters(params);
        }catch(error){console.warn("Could not apply low-bandwidth video settings",error);}
      });
    }
    callPeerConnection.ontrack=event=>{(event.streams?.[0]?.getTracks()||[event.track]).forEach(track=>{if(!callRemoteStream.getTracks().some(t=>t.id===track.id))callRemoteStream.addTrack(track);});$("remoteCallVideo").srcObject=event.streams?.[0]||callRemoteStream;};
    callPeerConnection.onicecandidate=event=>{if(event.candidate)sendPairCallSignal("ice",{candidate:event.candidate}).catch(error=>console.warn("Could not send ICE candidate",error));};
    let disconnectWarningTimer=null;
    callPeerConnection.onconnectionstatechange=()=>{
      const pc=callPeerConnection;if(!pc)return;
      if(pc.connectionState==="connected"){
        if(disconnectWarningTimer){clearTimeout(disconnectWarningTimer);disconnectWarningTimer=null;}
        startCallDurationTimer();showCallError("");
      }else if(pc.connectionState==="disconnected"){
        // Brief network handoffs are common; do not show a failure instantly.
        if(disconnectWarningTimer)clearTimeout(disconnectWarningTimer);
        disconnectWarningTimer=setTimeout(()=>{
          if(callPeerConnection===pc&&pc.connectionState==="disconnected"){
            showCallError("Connection is weak. Try switching to a stronger Wi-Fi or mobile network. Audio-only calls use less data.");
          }
        },8000);
      }else if(pc.connectionState==="failed"){
        if(disconnectWarningTimer){clearTimeout(disconnectWarningTimer);disconnectWarningTimer=null;}
        showCallError("Could not establish a stable connection. Try audio-only or switch networks. A TURN relay service may be needed on restricted networks.");
      }
    };
    return callPeerConnection;
  }
  async function createCallOffer(){
    await ensureCallMedia();await ensurePeerConnection();
    const offer=await callPeerConnection.createOffer();await callPeerConnection.setLocalDescription(offer);
    await sendPairCallSignal("offer",{description:callPeerConnection.localDescription});setCallActiveUI();
  }
  function startCallDurationTimer(){
    if(callTimerInterval)return;
    callStartedAt=Date.now();
    const timer=$("callDurationTimer");if(timer){timer.textContent="00:00";timer.classList.remove("hidden");}
    const tick=()=>{const elapsed=Math.max(0,Math.floor((Date.now()-callStartedAt)/1000));const minutes=String(Math.floor(elapsed/60)).padStart(2,"0");const seconds=String(elapsed%60).padStart(2,"0");if(timer)timer.textContent=minutes+":"+seconds;};
    tick();callTimerInterval=setInterval(tick,1000);
  }
  function stopCallDurationTimer(){if(callTimerInterval){clearInterval(callTimerInterval);callTimerInterval=null;}callStartedAt=null;const timer=$("callDurationTimer");if(timer){timer.textContent="00:00";timer.classList.add("hidden");}}
  function setCallActiveUI(){
    $("callSetupArea").classList.add("hidden");$("incomingCallArea").classList.add("hidden");$("activeCallArea").classList.remove("hidden");
    // Audio calls should not reserve or display the video surface.
    const audioOnly=activeCall?.mode!=="video";
    $("activeCallArea").classList.toggle("audio-only",audioOnly);
    $("audioCallContactName").textContent=callMemberName(activeCall?.caller?activeCall.toId:activeCall?.fromId);
    $("audioCallPlaceholder").classList.toggle("hidden",!audioOnly);
    $("toggleCallCameraBtn").classList.toggle("hidden",audioOnly);
    $("callStatusText").textContent=(audioOnly?"Audio":"Video")+" call · "+callMemberName(activeCall?.caller?activeCall.toId:activeCall?.fromId);
    callPanelOpen();
  }
  async function beginTeamCall(mode){
    if(localMode||!supabase||!session?.user?.id){showCallError("Secure team calling requires a signed-in Supabase account.");return;}
    const targetId=$("callContactSelect").value;if(!targetId){showCallError("Choose a team member first.");return;}
    if(targetId===session.user.id){showCallError("Choose another team member.");return;}
    if(activeCall||incomingCall){showCallError("Finish the current call before starting another one.");return;}
    activeCall={callId:crypto.randomUUID(),ownerId:teamOwnerId,fromId:session.user.id,toId:targetId,mode,caller:true};
    callPanelOpen();$("callSetupArea").classList.add("hidden");$("incomingCallArea").classList.add("hidden");$("activeCallArea").classList.add("hidden");$("callStatusText").textContent="Calling "+callMemberName(targetId)+"…";showCallError("");
    try{
      await startPairCallChannel();
      await sendCallInvite(targetId,{ownerId:teamOwnerId,callId:activeCall.callId,fromId:session.user.id,toId:targetId,fromName:session.user.user_metadata?.full_name||session.user.email||"Team member",mode});
      clearCallRingTimeout();const ringingCallId=activeCall.callId;callRingTimeout=setTimeout(async()=>{if(!activeCall?.caller||activeCall.callId!==ringingCallId)return;try{await sendCallInvite(targetId,{type:"call-state",ownerId:teamOwnerId,callId:ringingCallId,fromId:session.user.id,toId:targetId,state:"no-answer"});}catch(error){console.warn("Could not send missed-call status",error);}addNotification("Call not answered · "+callMemberName(targetId),"Your "+(mode==="video"?"video":"audio")+" call was not answered.","call");showCallError("No answer. A notification has been saved.");cleanupTeamCall(false);},30000);
    }catch(error){showCallError(error?.message||"Could not start the call.");cleanupTeamCall(false);$("callSetupArea").classList.remove("hidden");}
  }
  async function acceptIncomingCall(){
    if(!incomingCall)return;clearCallRingTimeout();stopIncomingRingtone();activeCall={...incomingCall,caller:false};incomingCall=null;
    $("incomingCallArea").classList.add("hidden");$("callSetupArea").classList.add("hidden");$("callStatusText").textContent="Connecting…";showCallError("");
    try{await ensureCallMedia();await startPairCallChannel();await sendPairCallState("accepted");setCallActiveUI();}
    catch(error){showCallError(error?.message||"Could not accept the call.");try{await sendCallInvite(activeCall?.fromId,{ownerId:teamOwnerId,callId:activeCall?.callId,fromId:session.user.id,toId:activeCall?.fromId,state:"rejected",type:"call-state"});}catch{}cleanupTeamCall(false);}
  }
  async function rejectIncomingCall(){
    const invite=incomingCall;if(!invite)return;clearCallRingTimeout();stopIncomingRingtone();incomingCall=null;$("incomingCallArea").classList.add("hidden");$("callSetupArea").classList.remove("hidden");
    try{await sendCallInvite(invite.fromId,{ownerId:teamOwnerId,callId:invite.callId,fromId:session.user.id,toId:invite.fromId,state:"rejected",type:"call-state"});}catch(error){console.warn("Could not notify caller of declined call",error);}
    $("callStatusText").textContent="Call declined";refreshCallContacts();
  }
  async function endTeamCall(remote=false){
    if(activeCall&&!remote){try{await sendPairCallState("ended");}catch(error){console.warn("Could not send call end signal",error);}}
    cleanupTeamCall(false);
  }
  function cleanupTeamCall(keepPanel=false){
    clearCallRingTimeout();stopIncomingRingtone();stopCallDurationTimer();
    if(callPeerConnection){callPeerConnection.ontrack=null;callPeerConnection.onicecandidate=null;callPeerConnection.close();callPeerConnection=null;}
    if(localCallStream){localCallStream.getTracks().forEach(track=>track.stop());localCallStream=null;}
    callRemoteStream=null;callMicMuted=false;callCameraOff=false;
    $("localCallVideo").srcObject=null;$("remoteCallVideo").srcObject=null;
    $("toggleCallMicBtn").innerHTML='<i class="fa-solid fa-microphone" aria-hidden="true"></i><span>Mute</span>';$("toggleCallCameraBtn").innerHTML='<i class="fa-solid fa-video" aria-hidden="true"></i><span>Camera</span>';
    if(callPairChannel&&supabase){supabase.removeChannel(callPairChannel);callPairChannel=null;}
    activeCall=null;incomingCall=null;$("activeCallArea").classList.add("hidden");$("activeCallArea").classList.remove("audio-only");$("audioCallPlaceholder").classList.add("hidden");$("toggleCallCameraBtn").classList.remove("hidden");$("incomingCallArea").classList.add("hidden");$("callSetupArea").classList.remove("hidden");
    $("callStatusText").textContent="Call ended";refreshCallContacts();
    if(!keepPanel){$("teamCallPanel").classList.add("hidden");$("teamCallPanel").classList.remove("is-open");}
  }
  $("startAudioCallBtn").addEventListener("click",()=>beginTeamCall("audio"));
  $("startVideoCallBtn").addEventListener("click",()=>beginTeamCall("video"));
  $("startAudioCallFromChat").addEventListener("click",()=>{closeTeamChat();callPanelOpen();refreshCallContacts();});
  $("startVideoCallFromChat").addEventListener("click",()=>{closeTeamChat();callPanelOpen();refreshCallContacts();});
  $("closeCallPanelBtn").addEventListener("click",closeCallPanel);
  $("acceptCallBtn").addEventListener("click",acceptIncomingCall);
  $("rejectCallBtn").addEventListener("click",rejectIncomingCall);
  $("endCallBtn").addEventListener("click",()=>endTeamCall(false));
  $("toggleCallMicBtn").addEventListener("click",()=>{if(!localCallStream)return;callMicMuted=!callMicMuted;localCallStream.getAudioTracks().forEach(track=>track.enabled=!callMicMuted);$("toggleCallMicBtn").innerHTML=callMicMuted?'<i class="fa-solid fa-microphone-slash" aria-hidden="true"></i><span>Unmute</span>':'<i class="fa-solid fa-microphone" aria-hidden="true"></i><span>Mute</span>';});
  $("toggleCallCameraBtn").addEventListener("click",()=>{if(!localCallStream)return;callCameraOff=!callCameraOff;localCallStream.getVideoTracks().forEach(track=>track.enabled=!callCameraOff);$("toggleCallCameraBtn").innerHTML=callCameraOff?'<i class="fa-solid fa-video-slash" aria-hidden="true"></i><span>Camera on</span>':'<i class="fa-solid fa-video" aria-hidden="true"></i><span>Camera</span>';});

  const chatStorageKey=()=>`electrostock_chat_seen_${session?.user?.id||"guest"}`;
  function loadSeenChatIds(){if(chatSeenInitialized)return;try{const raw=sessionStorage.getItem(chatStorageKey());if(raw)JSON.parse(raw).forEach(id=>seenChatMessageIds.add(id));else teamMessages.forEach(m=>seenChatMessageIds.add(m.id));}catch{}chatSeenInitialized=true;}
  function saveSeenChatIds(){try{sessionStorage.setItem(chatStorageKey(),JSON.stringify([...seenChatMessageIds].slice(-500)));}catch{}}
  function updateChatBadge(){const badge=$("chatUnreadBadge"),button=$("floatingChatBtn");if(!badge||!button)return;badge.textContent=chatUnreadCount>99?"99+":String(chatUnreadCount);badge.classList.toggle("hidden",chatUnreadCount===0);button.classList.toggle("has-unread",chatUnreadCount>0);button.setAttribute("aria-label",chatUnreadCount?`Open internal team chat, ${chatUnreadCount} unread messages`:"Open internal team chat");}
  function markChatRead(){chatUnreadCount=0;teamMessages.forEach(m=>seenChatMessageIds.add(m.id));saveSeenChatIds();updateChatBadge();}
  const notificationItems=[];
  let unreadNotificationCount=0,notificationUserKey="";
  function notificationStorageKey(){return "electrostock_notifications_v1_"+(session?.user?.id||"guest");}
  function saveNotifications(){
    try{localStorage.setItem(notificationStorageKey(),JSON.stringify(notificationItems.slice(0,50)));}catch{}
  }
  function loadSavedNotifications(){
    const key=notificationStorageKey();
    if(notificationUserKey===key)return;
    notificationUserKey=key;notificationItems.length=0;
    try{
      const saved=JSON.parse(localStorage.getItem(key)||"[]");
      if(Array.isArray(saved))saved.slice(0,50).forEach(n=>{if(n&&typeof n.title==="string")notificationItems.push({...n,read:!!n.read});});
    }catch{}
    unreadNotificationCount=notificationItems.filter(n=>!n.read).length;
    renderNotifications();
  }
  function renderNotifications(){
    const badge=$("notificationBadge"),list=$("notificationList");
    if(!badge||!list)return;
    unreadNotificationCount=notificationItems.filter(n=>!n.read).length;
    badge.textContent=unreadNotificationCount>99?"99+":String(unreadNotificationCount);
    badge.classList.toggle("hidden",unreadNotificationCount===0);
    list.innerHTML=notificationItems.length?notificationItems.map((n,i)=>'<button type="button" class="notification-item '+(n.read?"read":"unread")+'" data-notification-index="'+i+'"><span class="notification-item-icon">'+(n.kind==="chat"?'<i class="fa-solid fa-envelope" aria-hidden="true"></i>':n.kind==="subscription"?'<i class="fa-solid fa-crown" aria-hidden="true"></i>':'<i class="fa-regular fa-clock" aria-hidden="true"></i>')+'</span><span class="notification-item-copy"><strong>'+esc(n.title)+'</strong><small>'+esc(n.body)+'</small><time>'+esc(n.time)+'</time></span></button>').join(""):'<p class="notification-empty">You’re all caught up.</p>';
  }
  function addNotification(title,body,kind="attendance"){
    notificationItems.unshift({title,body,kind,time:new Date().toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit"}),date:new Date().toISOString(),read:false});
    if(notificationItems.length>50)notificationItems.length=50;
    unreadNotificationCount=notificationItems.filter(n=>!n.read).length;
    saveNotifications();renderNotifications();
  }
  function ensureDailySubscriptionReminder(){
    if(localMode||currentRole!=="owner"||hasActiveProSubscription()||proSubscription.error||!session?.user?.id)return;
    const today=new Date().toLocaleDateString("en-CA");
    const key="electrostock_subscription_reminder_"+session.user.id;
    try{if(localStorage.getItem(key)===today)return;}catch{}
    addNotification("Subscription reminder","Your ElectroStock Pro subscription is not active. Upgrade for advanced reports, unlimited products and staff, and custom business branding.","subscription");
    try{localStorage.setItem(key,today);}catch{}
  }
  function ensureWeeklyAndMonthlyMessages(){
    if(localMode||!session?.user?.id)return;
    const now=new Date();
    const pad=n=>String(n).padStart(2,"0");
    const monthKey=now.getFullYear()+"-"+pad(now.getMonth()+1);
    const monday=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
    const weekKey=monday.getFullYear()+"-"+pad(monday.getMonth()+1)+"-"+pad(monday.getDate());
    const monthStorageKey="electrostock_new_month_"+session.user.id;
    const weekStorageKey="electrostock_new_week_"+session.user.id;
    try{
      if(localStorage.getItem(monthStorageKey)!==monthKey){
        addNotification("Welcome to a new month!","A fresh month is here. Review your stock, sales and business performance, set new goals, and keep growing with ElectroStock.","announcement");
        localStorage.setItem(monthStorageKey,monthKey);
        sendBrowserNotification("Welcome to a new month!","Review your stock, sales and business goals.","electrostock-new-month-"+monthKey);
      }
      if(localStorage.getItem(weekStorageKey)!==weekKey){
        addNotification("A new week, a fresh start!","Wishing you a productive week. Check your inventory, follow up with customers, and stay on top of your sales.","announcement");
        localStorage.setItem(weekStorageKey,weekKey);
        sendBrowserNotification("A new week, a fresh start!","Check your inventory and make this week count.","electrostock-new-week-"+weekKey);
      }
    }catch(error){console.warn("Could not save the weekly/monthly welcome message:",error);}
  }
  function closeNotificationPanel(){
    $("notificationPanel")?.classList.add("hidden");
    $("enableNotificationsBtn")?.setAttribute("aria-expanded","false");
  }
  function sendBrowserNotification(title,body,tag){
    if(!document.hidden||!("Notification" in window)||Notification.permission!=="granted")return;
    try{new Notification("ElectroStock · "+title,{body,tag});}catch{}
  }
  async function requestBrowserNotifications(){
    if(!("Notification" in window)){toast("Browser notifications are not supported here. In-app alerts will still work.");return;}
    if(Notification.permission==="granted"){toast("Browser notifications are already enabled.");return;}
    if(Notification.permission==="denied"){toast("Notifications are blocked by your browser. Allow them in site settings.");return;}
    try{const permission=await Notification.requestPermission();toast(permission==="granted"?"Browser notifications enabled.":"In-app alerts will continue; browser notifications were not enabled.");}
    catch{toast("Could not enable browser notifications. Check your browser site settings.");}
  }
  function stopTeamMessageNotifications(){if(teamMessageChannel&&supabase){supabase.removeChannel(teamMessageChannel);teamMessageChannel=null;}}
  function startTeamMessageNotifications(){
    stopTeamMessageNotifications();
    if(localMode||!supabase||!session?.user?.id||!teamOwnerId)return;
    teamMessageChannel=supabase.channel("electrostock-chat-"+teamOwnerId+"-"+session.user.id)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"team_messages",filter:"owner_id=eq."+teamOwnerId},payload=>{
        const message=payload.new;if(!message?.id||message.sender_id===session?.user?.id||seenChatMessageIds.has(message.id))return;
        seenChatMessageIds.add(message.id);saveSeenChatIds();teamMessages.push(message);
        const chatOpen=!$("teamChatPanel").classList.contains("hidden");
        if(!chatOpen){chatUnreadCount++;updateChatBadge();}
        const sender=teamMembers.find(m=>m.user_id===message.sender_id)?.display_name||(message.sender_id===teamOwnerId?"Store owner":"Team member");
        const messageBody=String(message.message||"New message");addNotification("New team message · "+sender,messageBody,"chat");toast("New message from "+sender+": "+messageBody.slice(0,70));
        sendBrowserNotification("New team message · "+sender,String(message.message||"New message").slice(0,120),"electrostock-message-"+message.id);
        renderTeam();
      })
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"staff_attendance",filter:"owner_id=eq."+teamOwnerId},payload=>{
        const row=payload.new;if(!row?.id||row.user_id===session?.user?.id)return;
        const staff=teamMembers.find(m=>m.user_id===row.user_id);
        const who=staff?.display_name||"A team member";
        const body=who+" clocked in at "+teamDate(row.clock_in)+".";
        addNotification("Staff clock-in",body,"attendance");toast(body);sendBrowserNotification("Staff clock-in",body,"electrostock-attendance-in-"+row.id);
        refreshTeam();
      })
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"staff_attendance",filter:"owner_id=eq."+teamOwnerId},payload=>{
        const row=payload.new,previous=payload.old;if(!row?.id||row.user_id===session?.user?.id||!row.clock_out||previous?.clock_out)return;
        const staff=teamMembers.find(m=>m.user_id===row.user_id);
        const who=staff?.display_name||"A team member";
        const body=who+" clocked out at "+teamDate(row.clock_out)+".";
        addNotification("Staff clock-out",body,"attendance");toast(body);sendBrowserNotification("Staff clock-out",body,"electrostock-attendance-out-"+row.id);
        refreshTeam();
      }).subscribe();
  }
  const canManageStaff=()=>currentRole==="owner";
  const canManageProducts=()=>["owner","manager"].includes(currentRole);
  const teamDate=v=>v?new Date(v).toLocaleString("en-NG",{dateStyle:"medium",timeStyle:"short"}):"—";
  async function loadTeamData(){
    if(localMode||!session?.user?.id)return;
    teamOwnerId=session.user.id;currentRole="owner";
    const own=await supabase.from("store_members").select("*").eq("user_id",session.user.id).maybeSingle();
    if(own.data){teamOwnerId=own.data.owner_id;currentRole=own.data.role||"sales_rep";}
    const r=await Promise.all([
      supabase.from("store_members").select("*").eq("owner_id",teamOwnerId).order("created_at",{ascending:false}),
      supabase.from("team_messages").select("*").eq("owner_id",teamOwnerId).order("created_at",{ascending:true}).limit(200),
      supabase.from("store_announcements").select("*").eq("owner_id",teamOwnerId).order("created_at",{ascending:false}).limit(100),
      supabase.from("staff_attendance").select("*").eq("owner_id",teamOwnerId).order("clock_in",{ascending:false}).limit(300)
    ]);
    const incomingMessages=r[1].data||[], incomingAttendance=r[3].data||[];
    if(teamDataInitialized){
      const previousMessageIds=new Set(teamMessages.map(m=>m.id));
      incomingMessages.forEach(message=>{
        if(!message?.id||previousMessageIds.has(message.id)||message.sender_id===session?.user?.id)return;
        const sender=(teamMembers.find(m=>m.user_id===message.sender_id)||{}).display_name||(message.sender_id===teamOwnerId?"Store owner":"Team member");
        const body=String(message.message||"New message");
        if(!seenChatMessageIds.has(message.id)){
          seenChatMessageIds.add(message.id);chatUnreadCount++;
          addNotification("New team message · "+sender,body,"chat");
          sendBrowserNotification("New team message · "+sender,body.slice(0,120),"electrostock-message-"+message.id);
        }
      });
      const previousAttendanceById=new Map(attendanceRows.map(row=>[row.id,row]));
      incomingAttendance.forEach(row=>{
        const previous=previousAttendanceById.get(row.id);
        if(!row?.id||row.user_id===session?.user?.id)return;
        const staff=(teamMembers.find(m=>m.user_id===row.user_id)||{}).display_name||"A team member";
        if(!previous){
          const body=staff+" clocked in at "+teamDate(row.clock_in)+".";
          addNotification("Staff clock-in",body,"attendance");
          sendBrowserNotification("Staff clock-in",body,"electrostock-attendance-in-"+row.id);
        }else if(row.clock_out&&!previous.clock_out){
          const body=staff+" clocked out at "+teamDate(row.clock_out)+".";
          addNotification("Staff clock-out",body,"attendance");
          sendBrowserNotification("Staff clock-out",body,"electrostock-attendance-out-"+row.id);
        }
      });
    }
    teamMembers=r[0].data||[];teamMessages=incomingMessages;teamAnnouncements=r[2].data||[];attendanceRows=incomingAttendance;
    teamDataInitialized=true;
    loadSeenChatIds();
    const chatOpen=!$("teamChatPanel").classList.contains("hidden")&&!$("teamView").classList.contains("hidden");
    teamMessages.forEach(m=>{if(!seenChatMessageIds.has(m.id)&&m.sender_id!==session?.user?.id&&!chatOpen)chatUnreadCount++;seenChatMessageIds.add(m.id);});
    saveSeenChatIds();updateChatBadge();startTeamMessageNotifications();startTeamCallNotifications();renderTeam();refreshCallContacts();
    if(currentRole==="owner")await loadAttendanceQr();
  }
  async function generateAttendanceQr(){
    const message=$("attendanceQrMessage"),button=$("generateAttendanceQrBtn");
    if(currentRole!=="owner"){message.textContent="Only the store owner can generate or replace the attendance QR code.";return;}
    if(localMode||!supabase){message.textContent="Connect Supabase to create a secure store QR code.";return;}
    button.disabled=true;button.textContent="Generating…";message.textContent="";
    try{const token=crypto.randomUUID();const {data,error}=await supabase.from("store_attendance_qr").upsert({owner_id:teamOwnerId||session.user.id,token,updated_at:new Date().toISOString()},{onConflict:"owner_id"}).select("owner_id,token").single();if(error)throw error;attendanceQrToken=data.token;attendanceQrStoreId=data.owner_id;renderAttendanceQr();message.textContent="Store attendance QR code generated. Print it and place it at the shop entrance.";}
    catch(error){message.textContent=error?.message||"Could not generate the QR code. Run supabase/attendance_qr_migration.sql in Supabase first.";}
    finally{button.disabled=false;button.textContent="Generate store QR";}
  }
  function renderAttendanceQr(){
    const area=$("attendanceQrPrintArea"),target=$("attendanceQrCode");
    if(!attendanceQrToken||!window.QRCode){$("attendanceQrMessage").textContent="The QR code library did not load. Refresh the page and try again.";return;}
    target.innerHTML="";const scanUrl=window.location.origin+window.location.pathname+"?attendance="+encodeURIComponent(attendanceQrToken);
    new QRCode(target,{text:scanUrl,width:220,height:220,colorDark:"#101827",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.H});
    $("attendanceQrStoreName").textContent=companySettings.company_name||"ElectroStock";area.classList.remove("hidden");$("printAttendanceQrBtn").disabled=false;
  }
  async function loadAttendanceQr(){
    if(localMode||!supabase||currentRole!=="owner")return;
    const {data,error}=await supabase.from("store_attendance_qr").select("owner_id,token").eq("owner_id",teamOwnerId||session.user.id).maybeSingle();
    if(error){$("attendanceQrMessage").textContent="Run supabase/attendance_qr_migration.sql in Supabase SQL Editor to enable attendance QR codes.";return;}
    if(data){attendanceQrToken=data.token;attendanceQrStoreId=data.owner_id;renderAttendanceQr();}
  }
  function printAttendanceQr(){if(!attendanceQrToken){$("attendanceQrMessage").textContent="Generate the store QR code first.";return;}document.body.classList.add("printing-attendance-qr");window.addEventListener("afterprint",()=>document.body.classList.remove("printing-attendance-qr"),{once:true});window.print();setTimeout(()=>document.body.classList.remove("printing-attendance-qr"),60000);}
  function closeAttendanceScan(){const modal=$("attendanceScanModal");modal.classList.add("hidden");attendanceActionInProgress=false;modal.dataset.completed="false";modal.dataset.loadedToken="";$("confirmAttendanceBtn").disabled=false;$("cancelAttendanceScanBtn").textContent="Cancel";}
  async function handleAttendanceLink(token=attendanceTokenFromUrl){
    if(!token||!session?.user?.id||localMode||!supabase){if(localMode)$("attendanceScannerMessage").textContent="Secure attendance requires a connected Supabase account. Please sign in to your store account.";return;}
    const modal=$("attendanceScanModal");if(modal.dataset.loadedToken===token)return;modal.dataset.loadedToken=token;
    $("attendanceScanMessage").textContent="Verifying your staff account and store QR code…";$("confirmAttendanceBtn").disabled=true;modal.classList.remove("hidden");
    try{
      const {data:qr,error:qrError}=await supabase.from("store_attendance_qr").select("owner_id,token").eq("token",token).maybeSingle();
      if(qrError||!qr)throw new Error("This attendance QR code is invalid or does not belong to a store you can access.");
      const ownerId=qr.owner_id,isOwner=session.user.id===ownerId;
      const membershipResult=isOwner?{data:null,error:null}:await supabase.from("store_members").select("user_id,owner_id,display_name,email,role,active").eq("user_id",session.user.id).eq("owner_id",ownerId).maybeSingle();
      const member=membershipResult.data;
      if(!isOwner&&(membershipResult.error||!member||member.active===false))throw new Error("Your account is not an active member of this store. Ask the Owner to check your staff account.");
      attendanceQrStoreId=ownerId;attendanceQrToken=qr.token;
      $("attendanceScanName").textContent=isOwner?(session.user.user_metadata?.full_name||session.user.email||"Store owner"):(member.display_name||session.user.user_metadata?.full_name||"Staff member");
      $("attendanceScanRole").textContent=isOwner?"Owner":member.role==="manager"?"Manager":"Sales Rep";$("attendanceScanEmail").textContent=session.user.email||"—";
      $("attendanceScanStore").textContent=companySettings.company_name||"Your store";$("attendanceScanBadge").classList.remove("success");
      $("attendanceScanTitle").textContent="Confirm your attendance";$("attendanceScanIntro").textContent="Your staff account has been verified. Confirm the action below.";$("attendanceScanMessage").textContent="";
      const {data:openShift,error:shiftError}=await supabase.from("staff_attendance").select("id,clock_in,clock_out").eq("owner_id",ownerId).eq("user_id",session.user.id).is("clock_out",null).maybeSingle();if(shiftError)throw shiftError;
      modal.dataset.action=openShift?"out":"in";modal.dataset.shiftId=openShift?.id||"";modal.dataset.completed="false";
      $("confirmAttendanceBtn").textContent=openShift?"✓ Confirm check-out":"✓ Confirm check-in";$("attendanceScanTime").textContent=openShift?"Checked in at "+teamDate(openShift.clock_in):"Ready to check in · "+new Date().toLocaleString("en-NG",{dateStyle:"medium",timeStyle:"short"});
      $("confirmAttendanceBtn").disabled=false;window.history.replaceState({},document.title,window.location.pathname);
    }catch(error){$("attendanceScanTitle").textContent="Attendance verification failed";$("attendanceScanIntro").textContent="We could not verify this scan.";$("attendanceScanMessage").textContent=error?.message||"Ask the Owner to generate a new attendance QR code.";$("confirmAttendanceBtn").textContent="Unable to continue";$("confirmAttendanceBtn").disabled=true;$("attendanceScanBadge").classList.remove("success");}
  }
  async function confirmAttendanceAction(){
    const modal=$("attendanceScanModal"),button=$("confirmAttendanceBtn"),message=$("attendanceScanMessage");
    if(modal.dataset.completed==="true"){closeAttendanceScan();return;}if(attendanceActionInProgress||!attendanceQrStoreId||!session?.user?.id)return;
    const action=modal.dataset.action;attendanceActionInProgress=true;button.disabled=true;button.textContent="Processing securely…";message.textContent="";
    try{
      let result;if(action==="in"){result=await supabase.from("staff_attendance").insert({owner_id:attendanceQrStoreId,user_id:session.user.id}).select("id,clock_in").single();}
      else{const shiftId=modal.dataset.shiftId;if(!shiftId)throw new Error("No active check-in was found. Scan the store QR code again.");result=await supabase.from("staff_attendance").update({clock_out:new Date().toISOString()}).eq("id",shiftId).eq("user_id",session.user.id).is("clock_out",null).select("id,clock_out").maybeSingle();if(!result.error&&!result.data)throw new Error("This shift was already checked out. Scan the store QR code again.");}
      if(result.error)throw result.error;const stamp=action==="in"?result.data.clock_in:result.data.clock_out;
      $("attendanceScanBadge").classList.add("success");$("attendanceScanTitle").textContent=action==="in"?"Check-in Successful":"Check-out Successful";$("attendanceScanIntro").textContent=action==="in"?"Your attendance has been recorded successfully.":"Your check-out has been recorded successfully.";
      $("attendanceScanMessage").innerHTML='<i class="fa-solid fa-check" aria-hidden="true"></i> Saved to the store attendance records.';$("attendanceScanTime").textContent=new Date(stamp).toLocaleString("en-NG",{dateStyle:"full",timeStyle:"short"});
      button.innerHTML='<i class="fa-solid fa-check" aria-hidden="true"></i> Done';button.disabled=false;modal.dataset.completed="true";$("cancelAttendanceScanBtn").textContent="Close";
      $("attendanceMessage").textContent=action==="in"?"Check-in recorded successfully.":"Check-out recorded successfully.";await loadTeamData();toast(action==="in"?"Check-in successful.":"Check-out successful.");
    }catch(error){message.textContent=error?.message||"Could not save attendance. Please try again.";button.disabled=false;button.innerHTML=action==="in"?'<i class="fa-solid fa-check" aria-hidden="true"></i> Confirm check-in':'<i class="fa-solid fa-check" aria-hidden="true"></i> Confirm check-out';attendanceActionInProgress=false;}
  }
  function renderTeam(){
    $("teamStaffTable").innerHTML=teamMembers.length?teamMembers.map(m=>"<tr><td>"+esc(m.display_name)+"</td><td>"+esc(m.email)+"</td><td>"+(m.role==="manager"?"Manager":"Sales Rep")+"</td><td>"+(m.active?"Active":"Disabled")+"</td><td>"+(canManageStaff()?'<button class="mini-btn" data-member-toggle="'+m.id+'">'+(m.active?"Disable":"Enable")+"</button>":"—")+"</td></tr>").join(""):'<tr><td colspan="5">No staff members yet.</td></tr>';
    $("teamStaffTable").querySelectorAll("[data-member-toggle]").forEach(b=>b.addEventListener("click",async()=>{const m=teamMembers.find(x=>x.id===b.dataset.memberToggle);if(!m)return;const z=await supabase.from("store_members").update({active:!m.active,updated_at:new Date().toISOString()}).eq("id",m.id);if(z.error){$("teamStaffMessage").textContent=z.error.message;return;}await loadTeamData();}));
    $("teamChatMessages").innerHTML=teamMessages.length?teamMessages.map(m=>'<article class="team-message '+(m.sender_id===session?.user?.id?"mine":"")+'"><p>'+esc(m.message)+'</p><small>'+esc(teamMembers.find(x=>x.user_id===m.sender_id)?.display_name||(m.sender_id===teamOwnerId?"Store owner":"Team member"))+" · "+teamDate(m.created_at)+"</small></article>").join(""):'<p class="muted">No messages yet.</p>';
    $("teamAnnouncementsList").innerHTML=teamAnnouncements.length?teamAnnouncements.map(n=>'<article class="team-announcement"><h4>'+esc(n.title)+'</h4><small>'+teamDate(n.created_at)+'</small><p>'+esc(n.body)+"</p></article>").join(""):'<p class="muted">No announcements yet.</p>';
    const attendanceMonth=$("attendanceMonthFilter")?.value||currentMonthKey();const periodAttendance=attendanceRows.filter(r=>monthMatches(r.clock_in,attendanceMonth));$("attendanceTable").innerHTML=periodAttendance.length?periodAttendance.map(r=>{const m=teamMembers.find(x=>x.user_id===r.user_id);const hours=r.clock_out?((new Date(r.clock_out)-new Date(r.clock_in))/3600000).toFixed(2):"In progress";return "<tr><td>"+esc(m?.display_name||(r.user_id===teamOwnerId?"Store owner":"Staff member"))+"</td><td>"+teamDate(r.clock_in)+"</td><td>"+teamDate(r.clock_out)+"</td><td>"+hours+"</td></tr>";}).join(""):'<tr><td colspan="4">No attendance records yet.</td></tr>';
    const open=attendanceRows.find(r=>r.user_id===session?.user?.id&&!r.clock_out);
    $("attendanceStatus").textContent=open?"Clocked in since "+teamDate(open.clock_in):"Currently clocked out.";renderMyAttendance();
    $("attendanceQrAdmin").classList.toggle("hidden",currentRole!=="owner");
    $("inviteStaffForm").classList.toggle("hidden",!canManageStaff());
    const premiumStaffPlan=hasActiveProSubscription();
    const staffLimit=$("staffPlanLimit");
    if(staffLimit)staffLimit.textContent=premiumStaffPlan
      ? "Pro active · "+teamMembers.length+" staff account"+(teamMembers.length===1?"":"s")+" in use. Unlimited staff accounts included."
      : "Free plan · "+teamMembers.length+" of 1 included staff account used. Upgrade to Pro for unlimited staff.";
    const inviteButton=$("inviteStaffBtn");
    if(inviteButton){const blocked=!premiumStaffPlan&&teamMembers.length>=1;inviteButton.disabled=false;inviteButton.textContent=blocked?"Upgrade to add staff":"Invite staff";inviteButton.classList.toggle("secondary",blocked);inviteButton.setAttribute("aria-label",blocked?"Upgrade to ElectroStock Pro":"Invite staff");}
    $("announcementForm").classList.toggle("hidden",!["owner","manager"].includes(currentRole));
  }
  function showTeamTab(tab){document.querySelectorAll("[data-team-tab]").forEach(b=>b.classList.toggle("active",b.dataset.teamTab===tab));["staff","announcements","attendance"].forEach(n=>$("team"+({staff:"Staff",announcements:"Announcements",attendance:"Attendance"}[n])+"Panel").classList.toggle("hidden",n!==tab));if(tab==="chat")openTeamChat();else closeTeamChat();}
  async function openTeamChat(){const panel=$("teamChatPanel");panel.classList.remove("hidden");panel.classList.add("is-open");markChatRead();if(!localMode)await loadTeamData();markChatRead();setTimeout(()=>$("teamChatText").focus(),60);}
  function closeTeamChat(){const panel=$("teamChatPanel");panel.classList.add("hidden");panel.classList.remove("is-open");}
  document.querySelectorAll("[data-team-tab]").forEach(b=>b.addEventListener("click",()=>{if(b.dataset.teamTab==="chat"){openTeamChat();return;}showTeamTab(b.dataset.teamTab);}));
  $("closeChatBtn").addEventListener("click",closeTeamChat);
  async function refreshTeam(){if(localMode){toast("Connect Supabase to use team features.");return;}await loadTeamData();}
  $("inviteStaffForm").addEventListener("submit",async e=>{e.preventDefault();if(!canManageStaff())return;const b=$("inviteStaffBtn"),m=$("teamStaffMessage");m.textContent="";if(!hasActiveProSubscription()&&teamMembers.length>=1){m.textContent="Your Free plan includes the owner and 1 staff account. Upgrade to Pro for unlimited staff.";toast("Opening Premium upgrade options…");switchView("settings");const subscriptionCard=$("proSubscriptionCard");if(subscriptionCard)subscriptionCard.scrollIntoView({behavior:"smooth",block:"center"});return;}b.disabled=true;b.textContent="Inviting…";try{const z=await supabase.functions.invoke("invite-team-member",{body:{owner_id:teamOwnerId||session.user.id,display_name:$("staffFullName").value.trim(),email:$("staffEmail").value.trim().toLowerCase(),password:$("staffPassword").value,phone:$("staffPhone").value.trim()||null,role:$("staffRole").value}});if(z.error){let detail=z.error.message||"The Edge Function request failed.";try{const response=z.error.context;if(response&&typeof response.clone==="function"){const raw=await response.clone().text();if(raw){try{const payload=JSON.parse(raw);detail=payload.error||payload.message||raw;}catch{detail=raw;}}}}catch(parseErr){console.warn("Could not read Edge Function error response:",parseErr);}throw new Error(detail);}if(z.data?.error)throw new Error(z.data.error);$("inviteStaffForm").reset();m.textContent="Invitation sent. Ask staff to check email.";await loadTeamData();}catch(err){console.error("ElectroStock staff invitation failed:",err);m.textContent=err?.message||"Invite function failed. Open Supabase Edge Function logs for details.";}finally{b.disabled=false;b.textContent="Invite staff";}});
  $("teamChatForm").addEventListener("submit",async e=>{e.preventDefault();const message=$("teamChatText").value.trim();if(!message)return;const z=await supabase.from("team_messages").insert({owner_id:teamOwnerId||session.user.id,sender_id:session.user.id,message}).select("id");if(z.error){$("teamChatMessage").textContent=z.error.message;return;}if(z.data?.[0]?.id)seenChatMessageIds.add(z.data[0].id);$("teamChatText").value="";$("teamChatMessage").textContent="Message sent.";await loadTeamData();});
  $("refreshChatBtn").addEventListener("click",refreshTeam);
  // Let each user reposition the floating chat launcher; keep its location in this browser.
  (function makeChatLauncherMovable(){
    const button=$("floatingChatBtn");if(!button)return;
    const key="electrostock_chat_launcher_position";
    let startX=0,startY=0,startLeft=0,startTop=0,moved=false,dragging=false;
    try{const saved=JSON.parse(localStorage.getItem(key)||"null");if(saved&&Number.isFinite(saved.left)&&Number.isFinite(saved.top)){
      button.style.left=Math.max(0,Math.min(saved.left,window.innerWidth-180))+"px";
      button.style.top=Math.max(0,Math.min(saved.top,window.innerHeight-60))+"px";
      button.style.right="auto";button.style.bottom="auto";
    }}catch{}
    button.addEventListener("pointerdown",e=>{
      if(e.button!==0&&e.pointerType==="mouse")return;
      const rect=button.getBoundingClientRect();startX=e.clientX;startY=e.clientY;startLeft=rect.left;startTop=rect.top;moved=false;dragging=true;
      button.setPointerCapture?.(e.pointerId);
    });
    button.addEventListener("pointermove",e=>{
      if(!dragging)return;
      const dx=e.clientX-startX,dy=e.clientY-startY;
      if(!moved&&Math.abs(dx)+Math.abs(dy)<6)return;
      moved=true;button.classList.add("is-dragging");
      const left=Math.max(0,Math.min(startLeft+dx,window.innerWidth-button.offsetWidth));
      const top=Math.max(0,Math.min(startTop+dy,window.innerHeight-button.offsetHeight));
      button.style.left=left+"px";button.style.top=top+"px";button.style.right="auto";button.style.bottom="auto";
    });
    const endDrag=()=>{
      if(!dragging)return;dragging=false;button.classList.remove("is-dragging");
      if(moved){try{const rect=button.getBoundingClientRect();localStorage.setItem(key,JSON.stringify({left:rect.left,top:rect.top}));}catch{}}
    };
    button.addEventListener("pointerup",endDrag);button.addEventListener("pointercancel",endDrag);
    button.addEventListener("click",async e=>{
      if(moved){e.preventDefault();e.stopImmediatePropagation();moved=false;return;}
      if($("teamChatPanel").classList.contains("hidden")){openTeamChat();}else{closeTeamChat();}
    });
  })();
  $("announcementForm").addEventListener("submit",async e=>{e.preventDefault();const z=await supabase.from("store_announcements").insert({owner_id:teamOwnerId||session.user.id,author_id:session.user.id,title:$("announcementTitle").value.trim(),body:$("announcementBody").value.trim()});if(z.error){$("announcementMessage").textContent=z.error.message;return;}$("announcementForm").reset();$("announcementMessage").textContent="Announcement published.";await loadTeamData();});
  $("refreshAttendanceBtn").addEventListener("click",refreshTeam);
  $("generateAttendanceQrBtn").addEventListener("click",generateAttendanceQr);
  $("printAttendanceQrBtn").addEventListener("click",printAttendanceQr);
  $("confirmAttendanceBtn").addEventListener("click",confirmAttendanceAction);
  $("closeAttendanceScanBtn").addEventListener("click",closeAttendanceScan);
  $("cancelAttendanceScanBtn").addEventListener("click",closeAttendanceScan);

  let attendanceScanner=null;
  async function startAttendanceScanner(){
    const message=$("attendanceScannerMessage"),start=$("startAttendanceScanBtn"),stop=$("stopAttendanceScanBtn"),target=$("attendanceScanner");
    if(localMode||!supabase||!session?.user?.id){message.textContent="Please sign in to your store account with Supabase enabled before scanning attendance.";return;}
    if(!window.Html5Qrcode){message.textContent="The QR scanner could not load. Refresh the page and try again.";return;}
    start.disabled=true;message.textContent="Starting camera…";target.classList.remove("hidden");
    try{
      if(!attendanceScanner)attendanceScanner=new Html5Qrcode("attendanceScanner");
      await attendanceScanner.start({facingMode:"environment"},{fps:10,qrbox:{width:230,height:230}},async decodedText=>{
        message.textContent="QR code detected. Verifying…";stopAttendanceScanner();
        let token=decodedText;
        try{const url=new URL(decodedText);token=url.searchParams.get("attendance")||decodedText;}catch{}
        await handleAttendanceLink(token);
      },()=>{});
      message.textContent="Point your camera at the store's printed attendance QR code.";
      stop.classList.remove("hidden");start.textContent="Camera is on";
    }catch(error){message.textContent=error?.message||"Could not start the camera. Allow camera permission and use the site over HTTPS.";target.classList.add("hidden");}
    finally{start.disabled=false;}
  }
  async function stopAttendanceScanner(){
    const target=$("attendanceScanner"),stop=$("stopAttendanceScanBtn"),start=$("startAttendanceScanBtn");
    if(attendanceScanner){try{if(attendanceScanner.isScanning)await attendanceScanner.stop();}catch{}try{await attendanceScanner.clear();}catch{}attendanceScanner=null;}
    target.classList.add("hidden");stop.classList.add("hidden");start.textContent="Scan QR Code";
  }
  function renderMyAttendance(){
    const own=attendanceRows.filter(r=>r.user_id===session?.user?.id).sort((a,b)=>new Date(b.clock_in)-new Date(a.clock_in));
    const open=own.find(r=>!r.clock_out);
    $("myAttendanceStatus").textContent=open?"You are clocked in":"You are clocked out";
    $("myAttendanceLastTime").textContent=open?"Clocked in at "+teamDate(open.clock_in):(own[0]?"Last shift: "+teamDate(own[0].clock_in):"No attendance record yet.");
    const month=currentMonthKey(),rows=own.filter(r=>monthMatches(r.clock_in,month));
    $("myAttendanceTable").innerHTML=rows.length?rows.map(r=>{const hours=r.clock_out?((new Date(r.clock_out)-new Date(r.clock_in))/3600000).toFixed(2):"In progress";return "<tr><td>"+teamDate(r.clock_in).split(",")[0]+"</td><td>"+teamDate(r.clock_in)+"</td><td>"+teamDate(r.clock_out)+"</td><td>"+hours+"</td></tr>";}).join(""):'<tr><td colspan="4">No attendance records for this month.</td></tr>';
  }
  $("ownerGenerateAttendanceQrBtn").addEventListener("click",()=>{switchView("team");showTeamTab("attendance");$("attendanceQrAdmin").scrollIntoView({behavior:"smooth",block:"center"});});
  $("startAttendanceScanBtn").addEventListener("click",startAttendanceScanner);
  $("stopAttendanceScanBtn").addEventListener("click",stopAttendanceScanner);
  $("refreshMyAttendanceBtn").addEventListener("click",async()=>{await refreshTeam();renderMyAttendance();});
  async function notifySupportEmail(ticketId,messageId){
    try{
      const result=await supabase.functions.invoke("notify-support-email",{body:{ticket_id:ticketId,message_id:messageId}});
      if(result.error){
        let detail=result.error.message||"The email function request failed.";
        try{
          const response=result.error.context;
          if(response&&typeof response.clone==="function"){
            const raw=await response.clone().text();
            if(raw){
              try{const payload=JSON.parse(raw);detail=payload.error||payload.message||detail;}
              catch{if(raw.length<500)detail=raw;}
            }
          }
        }catch(readError){console.warn("Could not read support email error response:",readError);}
        throw new Error(detail);
      }
      if(result.data?.error)throw new Error(result.data.error);
      return "";
    }catch(error){
      console.error("ElectroStock support email notification failed:",error);
      return error?.message||"Email notification could not be sent.";
    }
  }
  async function loadSupportData(){
    if(!session?.user?.id || localMode){
      $("supportTicketList").innerHTML='<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-cloud" aria-hidden="true"></i></div><h3>Secure support needs an account</h3><p>Sign in with your Supabase-connected account to submit and track support requests.</p></div>';
      $("supportFormMessage").textContent=localMode?"Support tickets require the connected Supabase workspace; demo mode does not send or save requests.":"";
      return;
    }
    $("supportTicketList").innerHTML='<p class="muted support-loading"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Loading support requests…</p>';
    const admin=await supabase.from("platform_support_admins").select("user_id").eq("user_id",session.user.id).maybeSingle();
    isSupportAdmin=!admin.error&&!!admin.data;
    $("supportComposePanel").classList.toggle("hidden",isSupportAdmin);$("supportListHeading").textContent=isSupportAdmin?"Customer support inbox":"Your support requests";
    $("supportListDescription").textContent=isSupportAdmin?"Review customer cases and reply from the support team.":"Review request status and support replies.";
    const query=supabase.from("support_tickets").select("id,store_owner_id,created_by,subject,category,priority,status,created_at,updated_at").order("updated_at",{ascending:false}).limit(100);
    const result=isSupportAdmin?await query:await query.eq("store_owner_id",teamOwnerId||session.user.id);
    if(result.error){
      supportTickets=[];
      $("supportTicketList").innerHTML='<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-database" aria-hidden="true"></i></div><h3>Support setup required</h3><p>Run supabase/support_tickets_migration.sql in the Supabase SQL Editor, then refresh this page.</p><p class="tiny">'+esc(result.error.message)+'</p></div>';
      return;
    }
    supportTickets=result.data||[];renderSupportTickets();
    if(activeSupportTicketId&&!supportTickets.some(t=>t.id===activeSupportTicketId)){activeSupportTicketId=null;$("supportConversationPanel").classList.add("hidden");}
    if(activeSupportTicketId)await openSupportTicket(activeSupportTicketId,false);
  }
  function supportStatusLabel(status){return ({open:"Open",in_progress:"In progress",resolved:"Resolved"}[status]||status||"Open");}
  function renderSupportTickets(){
    const host=$("supportTicketList");
    if(!supportTickets.length){host.innerHTML='<div class="empty-state"><div class="empty-icon"><i class="fa-regular fa-comments" aria-hidden="true"></i></div><h3>No support requests yet</h3><p>'+(isSupportAdmin?"Customer tickets will appear here when users contact ElectroStock support.":"Submit a request using the form. Your updates will appear here.")+'</p></div>';return;}
    host.innerHTML=supportTickets.map(t=>'<button type="button" class="support-ticket-row '+(t.id===activeSupportTicketId?'selected':'')+'" data-support-ticket="'+esc(t.id)+'"><span class="support-ticket-main"><strong>'+esc(t.subject)+'</strong><small>'+esc(t.category)+' · '+new Date(t.updated_at||t.created_at).toLocaleString("en-NG",{dateStyle:"medium",timeStyle:"short"})+'</small></span><span class="support-ticket-meta"><span class="support-status status-'+esc(t.status)+'">'+esc(supportStatusLabel(t.status))+'</span><small class="support-priority priority-'+esc(t.priority)+'">'+esc(t.priority||"normal")+'</small></span></button>').join("");
    host.querySelectorAll("[data-support-ticket]").forEach(b=>b.addEventListener("click",()=>openSupportTicket(b.dataset.supportTicket)));
  }
  async function openSupportTicket(id,scroll=true){
    const ticket=supportTickets.find(t=>t.id===id);if(!ticket)return;
    activeSupportTicketId=id;renderSupportTickets();$("supportConversationPanel").classList.remove("hidden");
    $("supportTicketNumber").textContent="REQUEST · "+id.slice(0,8).toUpperCase();
    $("supportConversationTitle").textContent=ticket.subject;
    $("supportConversationMeta").textContent=ticket.category+" · "+supportStatusLabel(ticket.status)+" · Created "+new Date(ticket.created_at).toLocaleString("en-NG",{dateStyle:"medium",timeStyle:"short"});
    $("supportAdminStatusWrap").classList.toggle("hidden",!isSupportAdmin);$("supportAdminStatus").value=ticket.status||"open";$("supportReplyMessage").textContent="";
    const result=await supabase.from("support_ticket_messages").select("id,ticket_id,sender_id,message,created_at").eq("ticket_id",id).order("created_at",{ascending:true});
    const host=$("supportConversationMessages");
    if(result.error){host.innerHTML='<p class="form-message">Could not load replies: '+esc(result.error.message)+'</p>';return;}
    supportMessages=result.data||[];
    host.innerHTML=supportMessages.map(m=>'<article class="support-message '+(m.sender_id===session.user.id?'mine':'')+'"><div class="support-message-head"><strong>'+((m.sender_id===session.user.id)?"You":(isSupportAdmin?"Customer / store team":"ElectroStock support"))+'</strong><time>'+new Date(m.created_at).toLocaleString("en-NG",{dateStyle:"medium",timeStyle:"short"})+'</time></div><p>'+esc(m.message).replace(/\n/g,"<br>")+'</p></article>').join("")||'<p class="muted">No replies yet. Send a message below to continue.</p>';
    if(scroll)$("supportConversationPanel").scrollIntoView({behavior:"smooth",block:"start"});
  }
  // Support Centre workflows are active; the support view and forms are wired below.

  // Customer Support Centre: tickets are shared with the platform support team.
  $("supportCreateForm")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const msg=$("supportFormMessage"),button=$("supportCreateBtn");
    if(localMode||!session?.user?.id){msg.textContent="Sign in to submit a support request.";return;}
    const subject=$("supportSubject").value.trim(),body=$("supportInitialMessage").value.trim();
    if(!subject||!body){msg.textContent="Enter a subject and describe the issue.";return;}
    button.disabled=true;button.textContent="Submitting…";msg.textContent="";
    try{
      const ownerId=teamOwnerId||session.user.id;
      const created=await supabase.from("support_tickets").insert({store_owner_id:ownerId,created_by:session.user.id,subject,category:$("supportCategory").value,priority:$("supportPriority").value}).select("id").single();
      if(created.error)throw created.error;
      const posted=await supabase.from("support_ticket_messages").insert({ticket_id:created.data.id,sender_id:session.user.id,message:body});
      if(posted.error)throw posted.error;
      $("supportCreateForm").reset();msg.textContent="Your support request has been sent.";
      await loadSupportData();await openSupportTicket(created.data.id,false);toast("Support request submitted.");
    }catch(error){console.error("Support ticket submission failed:",error);msg.textContent=error.message||"Could not submit your request.";}
    finally{button.disabled=false;button.textContent="Submit request";}
  });
  $("supportReplyForm")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const message=$("supportReplyText").value.trim(),feedback=$("supportReplyMessage"),button=$("supportReplyBtn");
    if(!activeSupportTicketId||!message){feedback.textContent="Enter a message before sending.";return;}
    button.disabled=true;button.textContent="Sending…";feedback.textContent="";
    try{
      const posted=await supabase.from("support_ticket_messages").insert({ticket_id:activeSupportTicketId,sender_id:session.user.id,message});
      if(posted.error)throw posted.error;
      if(isSupportAdmin){
        const status=$("supportAdminStatus").value;
        const updated=await supabase.from("support_tickets").update({status,updated_at:new Date().toISOString()}).eq("id",activeSupportTicketId);
        if(updated.error)throw updated.error;
      }
      $("supportReplyText").value="";await loadSupportData();await openSupportTicket(activeSupportTicketId,false);
      feedback.textContent="Message sent.";toast("Support reply sent.");
    }catch(error){console.error("Support reply failed:",error);feedback.textContent=error.message||"Could not send your message.";}
    finally{button.disabled=false;button.textContent="Send message";}
  });
  $("supportRefreshBtn")?.addEventListener("click",()=>loadSupportData());
  $("supportAdminStatus")?.addEventListener("change",async()=>{
    if(!isSupportAdmin||!activeSupportTicketId)return;
    const {error}=await supabase.from("support_tickets").update({status:$("supportAdminStatus").value,updated_at:new Date().toISOString()}).eq("id",activeSupportTicketId);
    if(error){$("supportReplyMessage").textContent=error.message;return;}
    await loadSupportData();await openSupportTicket(activeSupportTicketId,false);
  });
  function switchView(view){if(view==="reports"&&!hasActiveProSubscription()){toast("Advanced Business Reports are available on ElectroStock Pro.");switchView("settings");return;}document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));$(view+"View").classList.remove("hidden");document.querySelectorAll(".nav-item[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));$("pageTitle").textContent=({dashboard:"Dashboard",products:"Products",pos:"Point of Sale",sales:"Sales management",stock:"Stock movement",attendance:"My Attendance",team:"Staff & Team",settings:"Company settings",support:"Support centre",reports:"Business reports",superadmin:"Super Admin"}[view]||"Dashboard");$("sidebar").classList.remove("mobile-open");$("mobileMenuBtn").setAttribute("aria-expanded","false");const owner=currentRole==="owner";$("ownerGenerateAttendanceQrBtn").classList.toggle("hidden",!owner);$("startAttendanceScanBtn").classList.toggle("hidden",owner);if(view==="attendance"){$("attendanceScannerMessage").textContent=owner?"As the store owner, generate the store attendance QR code for your staff.":"Scan the QR code displayed at your workplace to clock in or clock out.";loadTeamData();}if(view==="superadmin"){if(!isPlatformAdmin){switchView("dashboard");toast("Access denied.");return;}loadSuperAdminDashboard();}if(view==="settings")populateSettingsForm();if(view==="support")loadSupportData();if(view==="team"){showTeamTab("staff");loadTeamData();}}
  document.querySelectorAll(".nav-item[data-view]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
  document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.go)));
  $("addProductTop").addEventListener("click",()=>openModal());$("addProductBtn").addEventListener("click",()=>openModal());$("emptyAddBtn").addEventListener("click",()=>openModal());
  $("searchInput").addEventListener("input",renderProducts);$("categoryFilter").addEventListener("change",renderProducts);$("stockFilter").addEventListener("change",renderProducts);
  $("exportBtn").addEventListener("click",()=>{if(!hasActiveProSubscription()){toast("Inventory exports are available on ElectroStock Pro.");switchView("settings");return;}exportInventory();});
  $("importBtn").addEventListener("click",()=>{if(!hasActiveProSubscription()){toast("Excel inventory import is available on ElectroStock Pro.");switchView("settings");return;}if(!window.XLSX){alert("The Excel import library could not load. Refresh the page and try again.");return;} $("importFileInput").click();});
  $("importFileInput").addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;const btn=$("importBtn");btn.disabled=true;btn.textContent="Importing…";try{await importInventory(file);}catch(error){console.error("ElectroStock import failed:",error);alert("Import failed: "+(error?.message||"Please check your Excel file and try again."));}finally{btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-file-import" aria-hidden="true"></i> Import Excel';e.target.value="";}});
  $("salesSearch").addEventListener("input",renderSales);
  $("salesMonthFilter").addEventListener("change",renderSales);
  $("businessReportMonth").addEventListener("change",renderReports);
  $("exportReportsBtn").addEventListener("click",()=>{if(!hasActiveProSubscription()){toast("Report exports are available on ElectroStock Pro.");return;}exportBusinessReport();});
  $("movementMonthFilter").addEventListener("change",renderMovements);
  $("attendanceMonthFilter").addEventListener("change",renderTeam);
  function openSaleForm(){switchView("pos");$("posSearch").focus();$("posMessage").textContent="Add products to the cart to start a sale.";}
  $("recordSaleBtn").addEventListener("click",openSaleForm);$("emptyRecordSaleBtn").addEventListener("click",openSaleForm);
  $("mobileMenuBtn").addEventListener("click",()=>{const open=$("sidebar").classList.toggle("mobile-open");$("mobileMenuBtn").setAttribute("aria-expanded",String(open));$("mobileMenuBtn").innerHTML=open?'<i class="fa-solid fa-xmark" aria-hidden="true"></i>':'<i class="fa-solid fa-bars" aria-hidden="true"></i>';});
  $("movementType").addEventListener("change",()=>{$("customerFieldWrap").classList.toggle("hidden",$("movementType").value!=="sale");});
  $("closeReceiptBtn").addEventListener("click",closeReceipt);
  $("printReceiptBtn").addEventListener("click",()=>window.print());
  $("printInvoiceBtn").addEventListener("click",()=>{if(!hasActiveProSubscription()){toast("Professional invoices are available on ElectroStock Pro.");switchView("settings");return;}if(activeSalesDocumentData)showReceipt(activeSalesDocumentData,"invoice");window.print();});
  $("receiptModal").addEventListener("click",e=>{if(e.target===$("receiptModal"))closeReceipt();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeReceipt();});
  $("customerFieldWrap").classList.add("hidden");
  function applyCompanyBranding(){
    const name=(companySettings.company_name||"ElectroStock").trim()||"ElectroStock";
    $("sidebarCompanyName").innerHTML=`${esc(name)}<small>INVENTORY DESK</small>`;
    $("mobileCompanyName").textContent=name;$("footerCompanyName").textContent=name;$("receiptTitle").textContent=name;$("settingsPreviewName").textContent=name;
    const details=[companySettings.phone,companySettings.email,companySettings.address].filter(Boolean).join(" · ");$("receiptBusinessDetails").textContent=details;
    $("receiptFooterMessage").textContent=companySettings.receipt_footer||"Thank you for your patronage!";
    const activeLogo=hasActiveProSubscription()?companySettings.logo_url:"";
    const logoMarkup=activeLogo?`<img src="${esc(activeLogo)}" alt="Company logo">`:'E<span>+</span>';
    $("settingsLogoPreview").innerHTML=logoMarkup;$("receiptLogo").innerHTML=logoMarkup;
    ["authBrandLogo","sidebarBrandLogo","mobileBrandLogo"].forEach(id=>{const el=$(id);if(el)el.innerHTML=activeLogo?`<img src="${esc(activeLogo)}" alt="Company logo">`:'E<span>+</span>';});
    document.title=`${name} — Inventory Management`;updateProSubscriptionUI();
  }
  function populateSettingsForm(){
    if(!$('settingCompanyName'))return;
    $("settingCompanyName").value=companySettings.company_name||"ElectroStock";$("settingPhone").value=companySettings.phone||"";$("settingEmail").value=companySettings.email||"";$("settingAddress").value=companySettings.address||"";$("settingCurrency").value=companySettings.currency||"NGN";$("settingReceiptFooter").value=companySettings.receipt_footer||"Thank you for your patronage!";
    const ownerOnly=currentRole!=="owner";
    ["settingCompanyName","settingPhone","settingEmail","settingAddress","settingCurrency","settingLogoFile","settingReceiptFooter"].forEach(id=>{const el=$(id);if(el)el.disabled=ownerOnly;});
    $("saveSettingsBtn").classList.toggle("hidden",ownerOnly);
    $("subscribeLogoBtn").classList.toggle("hidden",ownerOnly);
    $("settingsMessage").textContent=ownerOnly?"Company settings are view-only. Ask the store owner to change business details, currency, or receipt settings.":"";
    applyCompanyBranding();
  }
  async function uploadCompanyLogo(file){
    if(!file)return {url:companySettings.logo_url,error:null};
    if(!["image/png","image/jpeg","image/webp"].includes(file.type))return {error:new Error("Please choose a PNG, JPG or WEBP image.")};
    if(file.size>2*1024*1024)return {error:new Error("Logo must be 2 MB or smaller.")};
    if(localMode){return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve({url:String(reader.result),error:null});reader.onerror=()=>resolve({error:new Error("Could not read the logo file.")});reader.readAsDataURL(file);});}
    if(!session?.user?.id)return {error:new Error("Please sign in again before uploading a logo.")};
    const ext=(file.name.split(".").pop()||"png").toLowerCase().replace(/[^a-z0-9]/g,"")||"png";
    const path=`${session.user.id}/company-logo.${ext}`;
    const {error}=await supabase.storage.from("company-logos").upload(path,file,{upsert:true,contentType:file.type});
    if(error)return {error};
    const {data}=supabase.storage.from("company-logos").getPublicUrl(path);return {url:data.publicUrl,error:null};
  }
  function hasActiveProSubscription(){
    return !localMode && !!(proSubscription.active && proSubscription.expires_at && new Date(proSubscription.expires_at)>new Date());
  }
  function updateProFeatureAccess(){
    const active=hasActiveProSubscription();
    const nav=document.querySelector('.nav-item[data-view="reports"]');
    if(nav)nav.classList.toggle("pro-locked",!active);
  }
  function updateProSubscriptionUI(){
    const active=hasActiveProSubscription();
    const input=$("settingLogoFile"),button=$("subscribeLogoBtn"),status=$("proSubscriptionStatus"),help=$("logoUploadHelp");
    if(input)input.disabled=!active;
    if(button){button.textContent=active?"Pro subscription active":"Upgrade to Pro · ₦5,000/month";button.classList.toggle("secondary",active);}
    if(status)status.textContent=active
      ? "ElectroStock Pro is active until "+new Date(proSubscription.expires_at).toLocaleDateString("en-NG",{day:"numeric",month:"short",year:"numeric"})+"."
      : (localMode?"Pro subscriptions are available to registered accounts only.":proSubscription.error?"Pro subscription status could not be verified. Refresh or contact support.":"Upgrade to ElectroStock Pro for unlimited products and staff, advanced reports, exports and custom business branding.");
    if(help)help.textContent=active?"Pro active. PNG, JPG or WEBP, maximum 2 MB.":"Upgrade to Pro to upload a logo. PNG, JPG or WEBP, maximum 2 MB.";
  }
  document.addEventListener("click",e=>{if(!e.target.closest(".notification-wrap"))closeNotificationPanel();});


  // Restore working Company Settings form submission and day/night appearance control.
  const appearanceKey="electrostock_appearance";
  function applyAppearance(){
    const mode=localStorage.getItem(appearanceKey)==="light"?"light":"dark";
    document.documentElement.dataset.theme=mode;
    const button=$("themeToggleBtn"),label=$("themeToggleLabel");
    if(button){button.setAttribute("aria-pressed",String(mode==="light"));button.setAttribute("aria-label",mode==="light"?"Switch to night mode":"Switch to day mode");}
    if(label)label.textContent=mode==="light"?"Switch to night mode":"Switch to day mode";
    const icon=button?.querySelector("i");if(icon)icon.className="fa-solid "+(mode==="light"?"fa-moon":"fa-sun");
  }
  applyAppearance();
  // Delegate the click so the control continues working even if the Settings
  // section is re-rendered after the page loads.
  document.addEventListener("click",event=>{
    const toggle=event.target.closest("#themeToggleBtn");
    if(!toggle)return;
    event.preventDefault();
    const next=document.documentElement.dataset.theme==="light"?"dark":"light";
    document.documentElement.dataset.theme=next;
    const label=$("themeToggleLabel");
    if(label)label.textContent=next==="light"?"Switch to night mode":"Switch to day mode";
    toggle.setAttribute("aria-pressed",String(next==="light"));
    toggle.setAttribute("aria-label",next==="light"?"Switch to night mode":"Switch to day mode");
    const icon=toggle.querySelector("i");
    if(icon)icon.className="fa-solid "+(next==="light"?"fa-moon":"fa-sun");
    try{localStorage.setItem(appearanceKey,next);}
    catch(storageError){console.warn("ElectroStock could not save the appearance preference:",storageError);}
  });
  $("settingsForm")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const button=$("saveSettingsBtn"),message=$("settingsMessage");
    if(currentRole!=="owner"){message.textContent="Only the Store Owner can save company settings.";return;}
    if(!localMode&&(!supabase||!session?.user?.id)){message.textContent="Your session is not available. Please sign in again.";return;}
    message.textContent="";button.disabled=true;button.textContent="Saving…";
    try{
      let logoUrl=companySettings.logo_url||"";
      const file=$("settingLogoFile")?.files?.[0];
      if(file){
        if(!hasActiveProSubscription())throw new Error("Upgrade to Pro before uploading a company logo.");
        const upload=await uploadCompanyLogo(file);if(upload.error)throw upload.error;logoUrl=upload.url||"";
      }
      const next={company_name:$("settingCompanyName").value.trim(),phone:$("settingPhone").value.trim(),email:$("settingEmail").value.trim(),address:$("settingAddress").value.trim(),currency:$("settingCurrency").value,logo_url:logoUrl,receipt_footer:$("settingReceiptFooter").value.trim()||defaultSettings.receipt_footer};
      if(!next.company_name)throw new Error("Business name is required.");
      if(localMode){companySettings={...defaultSettings,...next};saveLocal();}
      else{
        const {error}=await supabase.from("company_settings").upsert({...next,owner_id:teamOwnerId||session.user.id},{onConflict:"owner_id"});
        if(error)throw new Error(error.message);
        companySettings={...defaultSettings,...next};
      }
      applyCompanyBranding();populateSettingsForm();renderAll();
      message.textContent="Company settings saved successfully.";toast("Company settings saved.");
    }catch(error){console.error("ElectroStock settings save failed:",error);message.textContent=error?.message||"Could not save company settings.";}
    finally{button.disabled=false;button.textContent="Save company settings";}
  });

  function openModal(id=null){if(!canManageProducts()){toast("Only the owner or a manager can edit products.");return;}
    $("productForm").reset();$("productId").value="";$("productThreshold").value=3;$("productQty").value=0;$("productMessage").textContent="";$("modalTitle").textContent=id?"Edit product":"Add product";$("saveProductBtn").textContent=id?"Save changes":"Save product";
    if(id){const p=products.find(x=>x.id===id);if(!p)return;$("productId").value=p.id;$("productName").value=p.name||"";$("productBrand").value=p.brand||"";$("productModel").value=p.model||"";$("productCategory").value=p.category||"";$("productQty").value=p.quantity??0;$("productBuy").value=p.purchase_price??0;$("productSell").value=p.selling_price??0;$("productThreshold").value=p.low_stock_threshold??3;$("productImage").value=p.image_url||"";$("productDescription").value=p.description||"";}
    $("productModal").classList.remove("hidden");document.body.style.overflow="hidden";
  }
  function closeModal(){$("productModal").classList.add("hidden");document.body.style.overflow="";}
  $("closeModal").addEventListener("click",closeModal);$("cancelModal").addEventListener("click",closeModal);$("productModal").addEventListener("click",e=>{if(e.target===$("productModal"))closeModal();});document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();});
  $("productForm").addEventListener("submit",async e=>{
    e.preventDefault();const id=$("productId").value;
    const data={name:$("productName").value.trim(),brand:$("productBrand").value.trim()||null,model:$("productModel").value.trim()||null,category:$("productCategory").value,purchase_price:Number($("productBuy").value),selling_price:Number($("productSell").value),quantity:Number($("productQty").value),low_stock_threshold:Number($("productThreshold").value),image_url:$("productImage").value.trim()||null,description:$("productDescription").value.trim()||null};
    if(!data.name){$("productMessage").textContent="Product name is required.";return;}
    $("saveProductBtn").disabled=true;$("saveProductBtn").textContent="Saving…";
    const {error}=await saveProduct(data,id);
    $("saveProductBtn").disabled=false;$("saveProductBtn").textContent=id?"Save changes":"Save product";
    if(error){$("productMessage").textContent=error.message||"Could not save product.";return;}
    if(!localMode)await loadCloud();else renderAll();closeModal();toast(id?"Product updated.":"Product added.");switchView("products");
  });
  $("stockForm").addEventListener("submit",async e=>{
    e.preventDefault();const id=$("stockProduct").value,p=products.find(x=>x.id===id),type=$("movementType").value,qty=Number($("movementQty").value),customer=$("customerName").value.trim(),note=$("movementNote").value.trim();
    $("stockMessage").textContent="";
    if(!canManageProducts()&&type!=="sale"){$("stockMessage").textContent="Sales reps cannot add or adjust stock. Ask the owner or a manager.";return;}
    if(!p){$("stockMessage").textContent="Choose a product first.";return;}
    if(!Number.isInteger(qty)||qty<1){$("stockMessage").textContent="Enter a quantity of at least 1.";return;}
    if(type==="sale"&&qty>Number(p.quantity)){$("stockMessage").textContent="Sale quantity cannot exceed available stock.";return;}
    if(type==="adjustment"&&!confirm("This adjustment adds units. For stock reductions, use Sale / stock out."))return;
    if(type==="sale"){
      const createdAt=new Date().toISOString(),receiptNo="ES-"+createdAt.replace(/[-:TZ.]/g,"").slice(0,14)+"-"+Math.random().toString(36).slice(2,6).toUpperCase();
      const sale={id:crypto.randomUUID(),owner_id:session?.user?.id||null,product_id:p.id,product_name:p.name,brand:p.brand||null,model:p.model||null,quantity:qty,unit_purchase_price:Number(p.purchase_price||0),unit_selling_price:Number(p.selling_price||0),total_amount:Number(p.selling_price||0)*qty,gross_profit:(Number(p.selling_price||0)-Number(p.purchase_price||0))*qty,customer_name:customer||"Walk-in customer",note:note||null,receipt_number:receiptNo,created_at:createdAt};
      if(localMode){products=products.map(x=>x.id===id?{...x,quantity:Number(x.quantity)-qty}:x);sales.unshift(sale);movements.unshift({id:crypto.randomUUID(),product_id:id,product_name:p.name,movement_type:"sale",quantity_change:-qty,note:[`Receipt: ${receiptNo}`,`Customer: ${sale.customer_name}`,note].filter(Boolean).join(" | "),created_at:createdAt});saveLocal();}
      else {
        const {data,error}=await supabase.rpc("record_sale",{p_product_id:id,p_quantity:qty,p_customer_name:customer||null,p_note:note||null});
        if(error){$("stockMessage").textContent=error.message.includes("record_sale")?"Sales database setup is missing. Run supabase/sales_migration.sql in the Supabase SQL Editor, then try again.":error.message;return;}
        sale.id=data.id;sale.receipt_number=data.receipt_number;sale.created_at=data.created_at;sale.total_amount=Number(data.total_amount);sale.gross_profit=Number(data.gross_profit);sale.unit_selling_price=Number(data.unit_selling_price);sale.quantity=Number(data.quantity);sale.customer_name=data.customer_name||"Walk-in customer";sale.product_name=data.product_name;sales.unshift(sale);await loadCloud();
      }
      $("stockForm").reset();$("customerFieldWrap").classList.add("hidden");renderAll();$("stockMessage").textContent="Sale recorded successfully.";toast("Sale recorded. Inventory updated.");showReceipt(sale);switchView("sales");return;
    }
    const delta=type==="purchase"?qty:qty,updated={...p,quantity:Number(p.quantity)+delta};
    if(localMode){products=products.map(x=>x.id===id?updated:x);movements.unshift({id:crypto.randomUUID(),product_id:id,product_name:p.name,movement_type:type,quantity_change:delta,note:note||null,created_at:new Date().toISOString()});saveLocal();}
    else{const {error}=await supabase.from("products").update({quantity:updated.quantity}).eq("id",id);if(error){$("stockMessage").textContent=error.message;return;}const {error:me}=await supabase.from("stock_movements").insert({owner_id:teamOwnerId||session.user.id,product_id:id,movement_type:type,quantity_change:delta,note:note||null});if(me){toast("Quantity updated, but movement log failed: "+me.message);}await loadCloud();}
    $("stockForm").reset();$("customerFieldWrap").classList.add("hidden");renderAll();$("stockMessage").textContent="Stock movement saved.";toast("Stock updated successfully.");
  });

  async function refreshForLiveUpdates(){
    if(notificationRefreshInProgress||document.hidden||!session?.user?.id||localMode)return;
    if(!$("settingsView").classList.contains("hidden")||document.querySelector(".modal-backdrop:not(.hidden), .modal:not(.hidden), #onboardingModal:not(.hidden)"))return;
    if(document.activeElement&&/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName))return;
    notificationRefreshInProgress=true;
    try{await loadCloud({silent:true});}
    catch(error){console.warn("Background refresh failed:",error);}
    finally{notificationRefreshInProgress=false;}
  }
  window.setInterval(refreshForLiveUpdates,30000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshForLiveUpdates();});

  init();
})();