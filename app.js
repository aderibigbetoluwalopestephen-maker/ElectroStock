(() => {
  const $ = (id) => document.getElementById(id);
  const config = window.ELECTROSTOCK_CONFIG || {};
  const configured = config.supabaseUrl && config.supabaseAnonKey &&
    !config.supabaseUrl.includes("YOUR_") && !config.supabaseAnonKey.includes("YOUR_");
  let supabase = null, session = null, products = [], movements = [], sales = [], posCart = [], localMode = !configured;
  const attendanceTokenFromUrl = new URLSearchParams(window.location.search).get("attendance");
  let attendanceQrToken = null, attendanceQrStoreId = null, attendanceActionInProgress = false;
  let logoSubscription = {active:false, expires_at:null, error:null};
  let teamDataInitialized=false, notificationRefreshInProgress=false;
  let supportTickets=[], supportMessages=[], activeSupportTicketId=null, isSupportAdmin=false;
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
  async function init(){
    $("todayLabel").textContent=new Date().toLocaleDateString("en-NG",{weekday:"short",day:"numeric",month:"short",year:"numeric"});
    initializeMonthFilters();
    const callbackParams=new URLSearchParams(window.location.search);
    const callbackStatus=callbackParams.get("auth");
    const callbackError=callbackParams.get("error_description")||callbackParams.get("error");
    if(configured && window.supabase){
      supabase=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey);localMode=false;
      const {data:{session:s}}=await supabase.auth.getSession();session=s;
      supabase.auth.onAuthStateChange((event,s)=>{
        session=s;
        if(event==="PASSWORD_RECOVERY"){openPasswordReset();return;}
        if(s){setTimeout(async()=>{showApp();await loadCloud();},0);}else if(event==="SIGNED_OUT"){showAuth();}
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
    const {data,error}=await supabase.auth.signInWithPassword({email,password});
    $("loginBtn").disabled=false;$("loginBtn").textContent="Sign in";
    if(error){authMessage(error.message);return;}session=data.session;showApp();await loadCloud();
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
  async function loadCloud(options={}){
    if(localMode||!session?.user?.id)return;
    teamOwnerId=session.user.id;currentRole="owner";
    const membership=await supabase.from("store_members").select("owner_id,role").eq("user_id",session.user.id).maybeSingle();
    if(membership.data){teamOwnerId=membership.data.owner_id;currentRole=membership.data.role||"sales_rep";}
    loadSavedNotifications();
    const [pr,mv,sv,cs,sub]=await Promise.all([
      supabase.from("products").select("*").order("created_at",{ascending:false}),
      supabase.from("stock_movements").select("*, products(name)").order("created_at",{ascending:false}).limit(300),
      supabase.from("sales").select("*").order("created_at",{ascending:false}).limit(1000),
      supabase.from("company_settings").select("*").eq("owner_id",teamOwnerId).maybeSingle(),
      supabase.from("logo_subscriptions").select("status,expires_at").eq("owner_id",teamOwnerId).maybeSingle()
    ]);
    if(pr.error){products=[];toast("Products could not load: "+pr.error.message);}else products=pr.data||[];
    if(mv.error){movements=[];toast("Stock movements could not load: "+mv.error.message);}else movements=(mv.data||[]).map(m=>({...m,product_name:m.products?.name||"Deleted product"}));
    if(sv.error){sales=[];toast("Sales history needs attention: "+sv.error.message);}else sales=sv.data||[];
    companySettings={...defaultSettings,...(cs?.data||{})};
    logoSubscription={active:!sub?.error && sub?.data?.status==="active" && !!sub.data.expires_at && new Date(sub.data.expires_at)>new Date(),expires_at:sub?.data?.expires_at||null,error:sub?.error?.message||null};
    if(sub?.error)console.error("Logo subscription status could not be loaded:",sub.error.message);
    ensureDailySubscriptionReminder();
    renderAll();applyCompanyBranding();populateSettingsForm();
    await loadTeamData();
    await handleAttendanceLink();
    if(cs?.error){console.error("Company settings could not be checked:",cs.error.message);}
    if(!options.silent && !cs?.data && session?.user?.id && currentRole==="owner"){openOnboarding();}
  }
  async function saveProduct(data,id){
    if(!canManageProducts())return {error:{message:"Sales reps cannot add or edit store products. Ask the owner or a manager."}};
    if(localMode){
      if(id){products=products.map(p=>p.id===id?{...p,...data,updated_at:new Date().toISOString()}:p);}
      else products.unshift({...data,id:crypto.randomUUID(),created_at:new Date().toISOString()});
      saveLocal();return {error:null};
    }
    const result=id?await supabase.from("products").update(data).eq("id",id).select().single():await supabase.from("products").insert({...data,owner_id:session.user.id}).select().single();
    return result;
  }
  async function deleteProduct(id){
    if(!canManageProducts()){toast("Sales reps cannot delete store products. Ask the owner or a manager.");return;}
    if(!confirm("Delete this product? Its stock movement history may also be removed."))return;
    if(localMode){products=products.filter(p=>p.id!==id);movements=movements.filter(m=>m.product_id!==id);saveLocal();}
    else {const {error}=await supabase.from("products").delete().eq("id",id);if(error){toast(error.message);return;}await loadCloud();}
    renderAll();toast("Product deleted.");
  }
  function renderAll(){renderStats();renderProducts();renderRecent();renderAlerts();renderProductOptions();renderMovements();renderSales();renderPos();applyCompanyBranding();}
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
  function initializeMonthFilters(){const month=currentMonthKey();["salesMonthFilter","movementMonthFilter","attendanceMonthFilter"].forEach(id=>{const el=$(id);if(el&&!el.value)el.value=month;});}
  function renderMovements(){const month=$("movementMonthFilter")?.value||currentMonthKey();const monthly=movements.filter(m=>monthMatches(m.created_at,month));const added=monthly.filter(m=>Number(m.quantity_change)>0).reduce((sum,m)=>sum+Number(m.quantity_change),0);const sold=monthly.filter(m=>m.movement_type==="sale").reduce((sum,m)=>sum+Math.abs(Number(m.quantity_change)),0);const net=monthly.reduce((sum,m)=>sum+Number(m.quantity_change||0),0);$("monthlyStockAdded").textContent=added.toLocaleString("en-NG");$("monthlyStockSold").textContent=sold.toLocaleString("en-NG");$("monthlyStockNet").textContent=(net>0?"+":"")+net.toLocaleString("en-NG");const rows=monthly.slice(0,300);$("movementTable").innerHTML=rows.map(m=>`<tr><td>${fmtDate(m.created_at||new Date())}</td><td>${esc(m.product_name||products.find(p=>p.id===m.product_id)?.name||"Product")}</td><td>${esc(({purchase:"Purchase",adjustment:"Adjustment",sale:"Sale"}[m.movement_type]||m.movement_type||"Movement"))}</td><td style="color:${Number(m.quantity_change)>=0?"#78dfb4":"#ff9ba7"}">${Number(m.quantity_change)>0?"+":""}${Number(m.quantity_change)}</td><td>${esc(m.note||"—")}</td></tr>`).join("");$("emptyMovements").classList.toggle("hidden",rows.length>0);}

  let teamMembers=[],teamMessages=[],teamAnnouncements=[],attendanceRows=[],teamOwnerId=null,currentRole="owner";
  let teamMessageChannel=null,chatUnreadCount=0,chatSeenInitialized=false;
  const seenChatMessageIds=new Set();
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
    if(localMode||currentRole!=="owner"||hasActiveLogoSubscription()||logoSubscription.error||!session?.user?.id)return;
    const today=new Date().toLocaleDateString("en-CA");
    const key="electrostock_subscription_reminder_"+session.user.id;
    try{if(localStorage.getItem(key)===today)return;}catch{}
    addNotification("Subscription reminder","Your logo customization subscription is not active. Subscribe for ₦1,500/month to use your own business logo on ElectroStock and receipts.","subscription");
    try{localStorage.setItem(key,today);}catch{}
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
    saveSeenChatIds();updateChatBadge();startTeamMessageNotifications();renderTeam();
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
  function printAttendanceQr(){if(!attendanceQrToken){$("attendanceQrMessage").textContent="Generate the store QR code first.";return;}window.print();}
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
    const premiumStaffPlan=hasActiveLogoSubscription();
    const staffLimit=$("staffPlanLimit");
    if(staffLimit)staffLimit.textContent=premiumStaffPlan
      ? "Premium active · "+teamMembers.length+" staff member"+(teamMembers.length===1?"":"s")+" added. You can add more staff."
      : "Free plan · "+teamMembers.length+" of 2 staff members used. Subscribe to Premium to add more.";
    const inviteButton=$("inviteStaffBtn");
    if(inviteButton){const blocked=!premiumStaffPlan&&teamMembers.length>=2;inviteButton.disabled=false;inviteButton.textContent=blocked?"Upgrade to add staff":"Invite staff";inviteButton.classList.toggle("secondary",blocked);inviteButton.setAttribute("aria-label",blocked?"Open Premium upgrade options":"Invite staff");}
    $("announcementForm").classList.toggle("hidden",!["owner","manager"].includes(currentRole));
  }
  function showTeamTab(tab){document.querySelectorAll("[data-team-tab]").forEach(b=>b.classList.toggle("active",b.dataset.teamTab===tab));["staff","announcements","attendance"].forEach(n=>$("team"+({staff:"Staff",announcements:"Announcements",attendance:"Attendance"}[n])+"Panel").classList.toggle("hidden",n!==tab));if(tab==="chat")openTeamChat();else closeTeamChat();}
  async function openTeamChat(){const panel=$("teamChatPanel");panel.classList.remove("hidden");panel.classList.add("is-open");markChatRead();if(!localMode)await loadTeamData();markChatRead();setTimeout(()=>$("teamChatText").focus(),60);}
  function closeTeamChat(){const panel=$("teamChatPanel");panel.classList.add("hidden");panel.classList.remove("is-open");}
  document.querySelectorAll("[data-team-tab]").forEach(b=>b.addEventListener("click",()=>{if(b.dataset.teamTab==="chat"){openTeamChat();return;}showTeamTab(b.dataset.teamTab);}));
  $("closeChatBtn").addEventListener("click",closeTeamChat);
  async function refreshTeam(){if(localMode){toast("Connect Supabase to use team features.");return;}await loadTeamData();}
  $("inviteStaffForm").addEventListener("submit",async e=>{e.preventDefault();if(!canManageStaff())return;const b=$("inviteStaffBtn"),m=$("teamStaffMessage");m.textContent="";if(!hasActiveLogoSubscription()&&teamMembers.length>=2){m.textContent="Your Free plan allows up to 2 staff members. Open Company settings to upgrade to Premium.";toast("Opening Premium upgrade options…");switchView("settings");const subscriptionCard=$("logoSubscriptionCard");if(subscriptionCard)subscriptionCard.scrollIntoView({behavior:"smooth",block:"center"});return;}b.disabled=true;b.textContent="Inviting…";try{const z=await supabase.functions.invoke("invite-team-member",{body:{owner_id:teamOwnerId||session.user.id,display_name:$("staffFullName").value.trim(),email:$("staffEmail").value.trim().toLowerCase(),password:$("staffPassword").value,phone:$("staffPhone").value.trim()||null,role:$("staffRole").value}});if(z.error){let detail=z.error.message||"The Edge Function request failed.";try{const response=z.error.context;if(response&&typeof response.clone==="function"){const raw=await response.clone().text();if(raw){try{const payload=JSON.parse(raw);detail=payload.error||payload.message||raw;}catch{detail=raw;}}}}catch(parseErr){console.warn("Could not read Edge Function error response:",parseErr);}throw new Error(detail);}if(z.data?.error)throw new Error(z.data.error);$("inviteStaffForm").reset();m.textContent="Invitation sent. Ask staff to check email.";await loadTeamData();}catch(err){console.error("ElectroStock staff invitation failed:",err);m.textContent=err?.message||"Invite function failed. Open Supabase Edge Function logs for details.";}finally{b.disabled=false;b.textContent="Invite staff";}});
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
  $("supportTicketForm").addEventListener("submit",async e=>{
    e.preventDefault();
    if(localMode||!session?.user?.id){$("supportFormMessage").textContent="Sign in to your connected ElectroStock account to submit a support request.";return;}
    const subject=$("supportSubject").value.trim(),message=$("supportMessage").value.trim();if(!subject||!message)return;
    const btn=$("supportSubmitBtn");btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Submitting…';$("supportFormMessage").textContent="";
    try{
      const created=await supabase.from("support_tickets").insert({store_owner_id:teamOwnerId||session.user.id,created_by:session.user.id,subject,category:$("supportCategory").value,priority:$("supportPriority").value,status:"open"}).select("id").single();
      if(created.error)throw created.error;
      const reply=await supabase.from("support_ticket_messages").insert({ticket_id:created.data.id,sender_id:session.user.id,message}).select("id").single();
      if(reply.error){$("supportFormMessage").textContent="Ticket was created, but the first message could not be saved: "+reply.error.message;await loadSupportData();return;}
      const emailError=await notifySupportEmail(created.data.id,reply.data.id);
      $("supportTicketForm").reset();
      $("supportFormMessage").textContent=emailError?"Support request saved, but the email notification failed: "+emailError:"Support request submitted. An email notification has been sent to ElectroStock support.";
      await loadSupportData();await openSupportTicket(created.data.id);
    }catch(err){$("supportFormMessage").textContent=err?.message||"The support request could not be submitted. Check the support migration and try again.";}
    finally{btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Submit request';}
  });
  $("supportReplyForm").addEventListener("submit",async e=>{
    e.preventDefault();if(!activeSupportTicketId||!session?.user?.id)return;
    const message=$("supportReplyText").value.trim();if(!message)return;
    const btn=$("supportReplyForm").querySelector('button[type="submit"]');btn.disabled=true;$("supportReplyMessage").textContent="";
    const ticketId=activeSupportTicketId;
    const result=await supabase.from("support_ticket_messages").insert({ticket_id:ticketId,sender_id:session.user.id,message}).select("id").single();
    if(result.error){$("supportReplyMessage").textContent=result.error.message;btn.disabled=false;return;}
    const emailError=await notifySupportEmail(ticketId,result.data.id);
    $("supportReplyText").value="";
    await loadSupportData();await openSupportTicket(ticketId,false);
    $("supportReplyMessage").textContent=emailError?"Reply saved, but the email notification failed: "+emailError:(isSupportAdmin?"Reply sent and customer email notification delivered.":"Reply sent and support email notification delivered.");
    btn.disabled=false;
  });
  $("supportAdminStatus").addEventListener("change",async()=>{
    if(!isSupportAdmin||!activeSupportTicketId)return;
    const result=await supabase.from("support_tickets").update({status:$("supportAdminStatus").value,updated_at:new Date().toISOString()}).eq("id",activeSupportTicketId);
    if(result.error){toast("Ticket status could not be updated: "+result.error.message);return;}
    await loadSupportData();await openSupportTicket(activeSupportTicketId,false);toast("Support request status updated.");
  });
  $("refreshSupportBtn").addEventListener("click",loadSupportData);
  function switchView(view){document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));$(view+"View").classList.remove("hidden");document.querySelectorAll(".nav-item[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));$("pageTitle").textContent=({dashboard:"Dashboard",products:"Products",pos:"Point of Sale",sales:"Sales management",stock:"Stock movement",attendance:"My Attendance",team:"Staff & Team",settings:"Company settings",support:"Support centre"}[view]||"Dashboard");$("sidebar").classList.remove("mobile-open");$("mobileMenuBtn").setAttribute("aria-expanded","false");if(view==="settings")populateSettingsForm();if(view==="attendance"){loadTeamData();}if(view==="team"){showTeamTab("staff");loadTeamData();}}
  document.querySelectorAll(".nav-item[data-view]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
  document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.go)));
  $("addProductTop").addEventListener("click",()=>openModal());$("addProductBtn").addEventListener("click",()=>openModal());$("emptyAddBtn").addEventListener("click",()=>openModal());
  $("searchInput").addEventListener("input",renderProducts);$("categoryFilter").addEventListener("change",renderProducts);$("stockFilter").addEventListener("change",renderProducts);
  $("exportBtn").addEventListener("click",exportInventory);
  $("importBtn").addEventListener("click",()=>{if(!window.XLSX){alert("The Excel import library could not load. Refresh the page and try again.");return;} $("importFileInput").click();});
  $("importFileInput").addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;const btn=$("importBtn");btn.disabled=true;btn.textContent="Importing…";try{await importInventory(file);}catch(error){console.error("ElectroStock import failed:",error);alert("Import failed: "+(error?.message||"Please check your Excel file and try again."));}finally{btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-file-import" aria-hidden="true"></i> Import Excel';e.target.value="";}});
  $("salesSearch").addEventListener("input",renderSales);
  $("salesMonthFilter").addEventListener("change",renderSales);
  $("movementMonthFilter").addEventListener("change",renderMovements);
  $("attendanceMonthFilter").addEventListener("change",renderTeam);
  function openSaleForm(){switchView("pos");$("posSearch").focus();$("posMessage").textContent="Add products to the cart to start a sale.";}
  $("recordSaleBtn").addEventListener("click",openSaleForm);$("emptyRecordSaleBtn").addEventListener("click",openSaleForm);
  $("mobileMenuBtn").addEventListener("click",()=>{const open=$("sidebar").classList.toggle("mobile-open");$("mobileMenuBtn").setAttribute("aria-expanded",String(open));$("mobileMenuBtn").innerHTML=open?'<i class="fa-solid fa-xmark" aria-hidden="true"></i>':'<i class="fa-solid fa-bars" aria-hidden="true"></i>';});
  $("movementType").addEventListener("change",()=>{$("customerFieldWrap").classList.toggle("hidden",$("movementType").value!=="sale");});
  $("closeReceiptBtn").addEventListener("click",closeReceipt);
  $("printReceiptBtn").addEventListener("click",()=>window.print());
  $("receiptModal").addEventListener("click",e=>{if(e.target===$("receiptModal"))closeReceipt();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeReceipt();});
  $("customerFieldWrap").classList.add("hidden");
  function applyCompanyBranding(){
    const name=(companySettings.company_name||"ElectroStock").trim()||"ElectroStock";
    $("sidebarCompanyName").innerHTML=`${esc(name)}<small>INVENTORY DESK</small>`;
    $("mobileCompanyName").textContent=name;$("footerCompanyName").textContent=name;$("receiptTitle").textContent=name;$("settingsPreviewName").textContent=name;
    const details=[companySettings.phone,companySettings.email,companySettings.address].filter(Boolean).join(" · ");$("receiptBusinessDetails").textContent=details;
    $("receiptFooterMessage").textContent=companySettings.receipt_footer||"Thank you for your patronage!";
    const activeLogo=hasActiveLogoSubscription()?companySettings.logo_url:"";
    const logoMarkup=activeLogo?`<img src="${esc(activeLogo)}" alt="Company logo">`:'E<span>+</span>';
    $("settingsLogoPreview").innerHTML=logoMarkup;$("receiptLogo").innerHTML=logoMarkup;
    ["authBrandLogo","sidebarBrandLogo","mobileBrandLogo"].forEach(id=>{const el=$(id);if(el)el.innerHTML=activeLogo?`<img src="${esc(activeLogo)}" alt="Company logo">`:'E<span>+</span>';});
    document.title=`${name} — Inventory Management`;updateLogoSubscriptionUI();
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
  function hasActiveLogoSubscription(){
    return !localMode && !!(logoSubscription.active && logoSubscription.expires_at && new Date(logoSubscription.expires_at)>new Date());
  }
  function updateLogoSubscriptionUI(){
    const active=hasActiveLogoSubscription();
    const input=$("settingLogoFile"),button=$("subscribeLogoBtn"),status=$("logoSubscriptionStatus"),help=$("logoUploadHelp");
    if(input)input.disabled=!active;
    if(button){button.textContent=active?"Subscription active":"Subscribe for ₦1,500/month";button.classList.toggle("secondary",active);}
    if(status){
      status.textContent=active
        ? "Logo customization is active until "+new Date(logoSubscription.expires_at).toLocaleDateString("en-NG",{day:"numeric",month:"short",year:"numeric"})+"."
        : (localMode?"Logo subscriptions are available to registered accounts only.":logoSubscription.error?"Subscription status could not be verified. Refresh or contact support.":"An active ₦1,500/month subscription is required to customize your logo.");
    }
    if(help)help.textContent=active?"Subscription active. PNG, JPG or WEBP, maximum 2 MB.":"Subscribe for ₦1,500/month to upload a logo. PNG, JPG or WEBP, maximum 2 MB.";
  }
  $("subscribeLogoBtn").addEventListener("click",()=>{
    const status=$("logoSubscriptionStatus");
    const say=(message)=>{
      if(status)status.textContent=message;
      try{toast(message);}catch(err){console.warn("Toast notification unavailable:",err);}
    };
    try{
      say("Subscribe clicked. Checking payment setup…");
      if(hasActiveLogoSubscription()){say("Your logo subscription is active until "+new Date(logoSubscription.expires_at).toLocaleDateString("en-NG")+".");return;}
      if(localMode||!session?.user){say("Please sign in to a registered account before subscribing.");return;}
      if(logoSubscription.error){say("Could not check subscription status: "+logoSubscription.error);return;}
      if(!config.paystackPublicKey||!config.paystackPlanCode||config.paystackPublicKey.includes("YOUR_")||config.paystackPlanCode.includes("YOUR_")){say("Payment setup is incomplete. Check the Paystack public key and plan code in config.js.");return;}
      if(!window.PaystackPop||typeof window.PaystackPop.setup!=="function"){say("Paystack checkout did not load. Refresh the page. If this continues, check whether the Paystack script is blocked.");return;}
      say("Opening Paystack checkout…");
      const handler=window.PaystackPop.setup({
        key:config.paystackPublicKey,
        email:session.user.email,
        plan:config.paystackPlanCode,
        ref:"ESLOGO-"+session.user.id.slice(0,8)+"-"+Date.now(),
        metadata:{owner_id:session.user.id,feature:"logo_customization"},
        callback:function(response){
          say("Payment received. Verifying your subscription…");
          (async function(){
            try{
              const result=await supabase.functions.invoke("verify-logo-subscription",{body:{reference:response.reference}});
              if(result.error)throw new Error(result.error.message||"Verification service unavailable.");
              if(!result.data?.active)throw new Error(result.data?.error||"Subscription was not activated.");
              logoSubscription={active:true,expires_at:result.data.expires_at,error:null};
              updateLogoSubscriptionUI();applyCompanyBranding();
              say("Logo subscription activated.");
            }catch(err){
              console.error("Logo subscription verification failed:",err);
              say("Payment verification failed. Keep this reference for support: "+response.reference);
            }
          })();
        },
        onClose:()=>{if(!hasActiveLogoSubscription())say("Checkout closed before payment was confirmed.");}
      });
      if(!handler||typeof handler.openIframe!=="function")throw new Error("Paystack could not initialize checkout.");
      handler.openIframe();
    }catch(err){
      console.error("Paystack checkout error:",err);
      say("Checkout could not open: "+(err?.message||"Unknown error"));
    }
  });
  $("settingCompanyName").addEventListener("input",()=>$("settingsPreviewName").textContent=$("settingCompanyName").value.trim()||"Your company name");
  $("settingLogoFile").addEventListener("change",()=>{const file=$("settingLogoFile").files[0];if(!file)return;if(!hasActiveLogoSubscription()){$("settingLogoFile").value="";$("settingsMessage").textContent="An active ₦1,500/month subscription is required to upload a logo.";return;}if(file.size>2*1024*1024){$("settingsMessage").textContent="Logo must be 2 MB or smaller.";$("settingLogoFile").value="";return;}const url=URL.createObjectURL(file);$("settingsLogoPreview").innerHTML=`<img src="${url}" alt="Logo preview">`;});
  $("settingsForm").addEventListener("submit",async e=>{if(currentRole!=="owner"){e.preventDefault();toast("Only the store owner can change company settings.");return;}
    e.preventDefault();const btn=$("saveSettingsBtn"),message=$("settingsMessage");message.textContent="";
    const company_name=$("settingCompanyName").value.trim();if(!company_name){message.textContent="Company name is required.";return;}
    const requestedLogo=$("settingLogoFile").files[0];
    if(requestedLogo&&!hasActiveLogoSubscription()){message.textContent="An active ₦1,500/month subscription is required before uploading a logo.";return;}
    btn.disabled=true;btn.textContent="Saving…";
    let logo_url=companySettings.logo_url||"";const file=$("settingLogoFile").files[0];
    if(file){const uploaded=await uploadCompanyLogo(file);if(uploaded.error){message.textContent=uploaded.error.message.includes("company-logos")?uploaded.error.message+" — run supabase/company_settings_migration.sql first.":uploaded.error.message;btn.disabled=false;btn.textContent="Save company settings";return;}logo_url=uploaded.url||"";}
    const next={company_name,phone:$("settingPhone").value.trim(),email:$("settingEmail").value.trim(),address:$("settingAddress").value.trim(),currency:$("settingCurrency").value,logo_url,receipt_footer:$("settingReceiptFooter").value.trim()||"Thank you for your patronage!"};
    if(localMode){companySettings={...defaultSettings,...next};saveLocal();}
    else {const {error}=await supabase.from("company_settings").upsert({...next,owner_id:teamOwnerId||session.user.id},{onConflict:"owner_id"});if(error){message.textContent=error.message.includes("company_settings")?error.message+" — run supabase/company_settings_migration.sql in Supabase SQL Editor.":error.message;btn.disabled=false;btn.textContent="Save company settings";return;}companySettings={...defaultSettings,...next};}
    btn.disabled=false;btn.textContent="Save company settings";$("settingLogoFile").value="";applyCompanyBranding();message.textContent="Company settings saved successfully.";toast("Company settings saved.");
  });
  const appearanceStorageKey = "electrostock_appearance_v1";
  const defaultAppearance = { mode:"dark", accent:"#8b7cff" };
  function readAppearance(){
    try {
      const saved=JSON.parse(localStorage.getItem(appearanceStorageKey)||"{}");
      const accent="#8b7cff";
      return {mode:saved.mode==="light"?"light":"dark",accent};
    } catch { return {...defaultAppearance}; }
  }
  function applyAppearance(save=true){
    const mode=appearance.mode;
    document.documentElement.dataset.theme=mode;
    document.documentElement.style.setProperty("--purple",appearance.accent);
    document.documentElement.style.setProperty("--cyan",appearance.accent);
    const toggle=$("themeToggleBtn");
    if(toggle){
      const isLight=mode==="light";
      toggle.setAttribute("aria-pressed",String(isLight));
      toggle.setAttribute("aria-label",isLight?"Switch to night mode":"Switch to day mode");
      toggle.innerHTML=(isLight?'<i class="fa-solid fa-moon" aria-hidden="true"></i>':'<i class="fa-solid fa-sun" aria-hidden="true"></i>')+'<span>'+(isLight?"Switch to night mode":"Switch to day mode")+'</span>';
    }
    if(save){try{localStorage.setItem(appearanceStorageKey,JSON.stringify(appearance));}catch{}}
  }
  let appearance=readAppearance();
  function setAppearanceMode(mode){
    appearance.mode=mode==="light"?"light":"dark";
    applyAppearance(true);
  }
  document.documentElement.dataset.theme=appearance.mode;
  document.documentElement.style.setProperty("--purple",appearance.accent);
  document.documentElement.style.setProperty("--cyan",appearance.accent);
  $("themeToggleBtn")?.addEventListener("click",()=>setAppearanceMode(appearance.mode==="dark"?"light":"dark"));
  applyAppearance(false);
  function csvCell(value){const text=String(value??"");return '"'+text.replace(/"/g,'""')+'"';}
  function normalizeImportHeader(value){return String(value??"").trim().toLowerCase().replace(/[()]/g,"").replace(/[^a-z0-9]+/g," ").trim();}
  async function importInventory(file){
    if(!canManageProducts())throw new Error("Sales reps cannot import or add products. Ask the owner or a manager.");
    if(!window.XLSX){throw new Error("Excel support could not load. Check your internet connection and refresh.");}
    const buffer=await file.arrayBuffer();
    const workbook=XLSX.read(buffer,{type:"array"});
    const firstSheet=workbook.Sheets[workbook.SheetNames[0]];
    if(!firstSheet)throw new Error("The workbook has no worksheet.");
    const rows=XLSX.utils.sheet_to_json(firstSheet,{defval:"",raw:false});
    if(!rows.length)throw new Error("The selected sheet is empty.");
    const headerMap=new Map(Object.keys(rows[0]).map(k=>[normalizeImportHeader(k),k]));
    const pick=(row,...names)=>{for(const name of names){const key=headerMap.get(normalizeImportHeader(name));if(key!==undefined&&row[key]!==""&&row[key]!==null)return row[key];}return "";};
    const parsed=rows.map((row,index)=>{
      const name=String(pick(row,"Product name","Product","Name","Item name","Item")).trim();
      if(!name)return null;
      const category=String(pick(row,"Category","Product category")||"Other").trim();
      const number=(v,fallback=0)=>{const n=Number(String(v??"").replace(/[₦,$£€\s,]/g,""));return Number.isFinite(n)&&String(v).trim()!==""?n:fallback;};
      const quantity=number(pick(row,"Quantity","Qty","Stock","Units"),0);
      const purchase_price=number(pick(row,"Purchase price NGN","Purchase price","Cost price","Buy price","Buying price"),0);
      const selling_price=number(pick(row,"Selling price NGN","Selling price","Sell price","Retail price","Price"),0);
      const threshold=number(pick(row,"Low-stock threshold","Low stock threshold","Reorder level"),3);
      if(quantity<0||purchase_price<0||selling_price<0||threshold<0)throw new Error("Row "+(index+2)+" has a negative quantity or price.");
      return {name,brand:String(pick(row,"Brand")||"").trim()||null,model:String(pick(row,"Model")||"").trim()||null,category,purchase_price,selling_price,quantity,low_stock_threshold:threshold,image_url:String(pick(row,"Image URL","Image","Image link")||"").trim()||null,description:String(pick(row,"Description","Notes")||"").trim()||null};
    }).filter(Boolean);
    if(!parsed.length)throw new Error('No product rows found. Include a "Product name" column and at least one product row.');
    if(localMode){
      const now=new Date().toISOString();
      products=[...parsed.map(p=>({...p,id:crypto.randomUUID(),created_at:now})),...products];
      saveLocal();renderAll();
    }else{
      if(!session?.user?.id)throw new Error("Please sign in again before importing products.");
      const batch=parsed.map(p=>({...p,owner_id:session.user.id}));
      const {error}=await supabase.from("products").insert(batch);
      if(error)throw new Error(error.message);
      await loadCloud();
    }
    switchView("products");
    toast("Imported "+parsed.length+" product"+(parsed.length===1?"":"s")+" successfully.");
  }
  function exportInventory(){
    const currency=companySettings.currency||"NGN";const rows=products.map(p=>({"Product name":p.name,"Brand / maker":p.brand||"","Variant / size":p.model||"","Category":p.category||"Other",[`Purchase price (${currency})`]:Number(p.purchase_price||0),[`Selling price (${currency})`]:Number(p.selling_price||0),"Quantity":Number(p.quantity||0),"Low-stock threshold":Number(p.low_stock_threshold??3),"Stock status":statusText(statusOf(p)),[`Inventory cost value (${currency})`]:Number(p.purchase_price||0)*Number(p.quantity||0),"Image URL":p.image_url||"","Description":p.description||"","Created at":p.created_at||""}));
    const fileDate=new Date().toISOString().slice(0,10);
    if(window.XLSX){const ws=XLSX.utils.json_to_sheet(rows);ws["!cols"]=[{wch:28},{wch:18},{wch:18},{wch:18},{wch:22},{wch:22},{wch:12},{wch:18},{wch:18},{wch:26},{wch:34},{wch:42},{wch:24}];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Inventory");XLSX.writeFile(wb,`ElectroStock-inventory-${fileDate}.xlsx`);toast("Excel inventory file downloaded.");return;}
    const headers=Object.keys(rows[0]||{"Product name":""});const csv="\uFEFF"+[headers,...rows.map(r=>headers.map(h=>r[h]))].map(row=>row.map(csvCell).join(",")).join("\r\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`ElectroStock-inventory-${fileDate}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);toast("Inventory exported as a CSV file for Excel.");
  }
  function showReceipt(sale){
    const now=new Date(sale.created_at||new Date());
    const items=Array.isArray(sale.items)&&sale.items.length?sale.items:[sale];
    applyCompanyBranding();
    $("receiptNumber").textContent=sale.receipt_number||items[0]?.receipt_number||"—";
    $("receiptDate").textContent=now.toLocaleString("en-NG",{dateStyle:"medium",timeStyle:"short"});
    $("receiptCustomer").textContent=sale.customer_name||items[0]?.customer_name||"Walk-in customer";
    $("receiptPaymentMethod").textContent=String(sale.payment_method||items[0]?.payment_method||"cash").replace(/^./,c=>c.toUpperCase());
    $("receiptItems").innerHTML=items.map(item=>'<div class="receipt-item"><div><strong>'+esc(item.product_name||"Product")+'</strong><small>'+Number(item.quantity||0)+' × '+money(item.unit_selling_price)+'</small></div><strong>'+money(item.total_amount)+'</strong></div>').join("");
    const total=Number(sale.total_amount??items.reduce((sum,item)=>sum+Number(item.total_amount||0),0));
    $("receiptTotal").textContent=money(total);
    $("receiptModal").classList.remove("hidden");document.body.style.overflow="hidden";
  }
  function renderSales(){
    const today=new Date();const isToday=s=>{const d=new Date(s.created_at);return d.getFullYear()===today.getFullYear()&&d.getMonth()===today.getMonth()&&d.getDate()===today.getDate();};
    const todays=sales.filter(isToday);
    const selectedMonth=$("salesMonthFilter")?.value||currentMonthKey();
    const monthSales=sales.filter(s=>monthMatches(s.created_at,selectedMonth));
    const groups=new Map();
    monthSales.forEach(s=>{
      const key=s.transaction_ref||s.receipt_number||s.id;
      if(!groups.has(key))groups.set(key,{...s,items:[],total_amount:0,gross_profit:0,quantity:0});
      const group=groups.get(key);group.items.push(s);group.total_amount+=Number(s.total_amount||0);group.gross_profit+=Number(s.gross_profit||0);group.quantity+=Number(s.quantity||0);
      if(new Date(s.created_at||0)<new Date(group.created_at||0))group.created_at=s.created_at;
    });
    const receipts=[...groups.values()];
    const todayGroups=new Map();todays.forEach(s=>{const k=s.transaction_ref||s.receipt_number||s.id;if(!todayGroups.has(k))todayGroups.set(k,[]);todayGroups.get(k).push(s);});
    $("salesTodayCount").textContent=todayGroups.size;
    $("salesTodayRevenue").textContent=money(todays.reduce((sum,s)=>sum+Number(s.total_amount||0),0));
    $("salesTodayProfit").textContent=money(todays.reduce((sum,s)=>sum+Number(s.gross_profit||0),0));
    const q=($("salesSearch")?.value||"").trim().toLowerCase();
    const list=receipts.filter(s=>[s.receipt_number,s.transaction_ref,s.customer_name,s.note,...s.items.map(i=>i.product_name)].join(" ").toLowerCase().includes(q));
    $("salesTable").innerHTML=list.map(s=>'<tr><td>'+fmtDate(s.created_at)+'</td><td><strong>'+esc(s.receipt_number||s.transaction_ref||"—")+'</strong></td><td>'+esc(s.items.map(i=>i.product_name).filter(Boolean).join(", ")||"Deleted product")+'</td><td>'+esc(s.customer_name||"Walk-in")+'</td><td>'+s.quantity+'</td><td>'+money(s.items[0]?.unit_selling_price||0)+'</td><td><strong>'+money(s.total_amount)+'</strong></td><td>'+money(s.gross_profit)+'</td><td><button class="mini-btn" data-reprint="'+esc(String(s.id))+'">Reprint</button></td></tr>').join("");
    $("emptySales").classList.toggle("hidden",list.length>0);
    $("salesTable").querySelectorAll("[data-reprint]").forEach(b=>b.addEventListener("click",()=>{const sale=list.find(x=>String(x.id)===b.dataset.reprint);if(sale)showReceipt(sale);}));
  }
  function closeReceipt(){$("receiptModal").classList.add("hidden");document.body.style.overflow="";}
  function posCartDetails(){
    return posCart.map(line=>{const p=products.find(x=>String(x.id)===String(line.product_id));return p?{...line,product:p,quantity:Number(line.quantity),lineTotal:Number(p.selling_price||0)*Number(line.quantity)}:null;}).filter(Boolean);
  }
  function renderPos(){
    const query=($("posSearch")?.value||"").trim().toLowerCase();
    const matches=products.filter(p=>(Number(p.quantity)||0)>0&&[p.name,p.brand,p.model,p.category].join(" ").toLowerCase().includes(query)).slice(0,40);
    $("posProductResults").innerHTML=matches.length?matches.map(p=>'<article class="pos-product"><div class="pos-product-info"><strong>'+esc(p.name)+'</strong><small>'+esc([p.brand,p.model,p.category].filter(Boolean).join(" · ")||"Product")+'</small><span>'+money(p.selling_price)+' · '+Number(p.quantity)+' in stock</span></div><button type="button" class="btn secondary pos-add-btn" data-add-pos="'+esc(String(p.id))+'">Add</button></article>').join(""):'<div class="empty-state"><h3>No available products found</h3><p>Try another search or add stock to your catalogue.</p></div>';
    const details=posCartDetails();
    $("posCartCount").textContent=details.reduce((sum,line)=>sum+line.quantity,0);
    $("posCartItems").innerHTML=details.length?details.map(line=>'<div class="pos-cart-item"><div class="pos-cart-item-main"><strong>'+esc(line.product.name)+'</strong><small>'+money(line.product.selling_price)+' each</small><strong>'+money(line.lineTotal)+'</strong></div><div class="pos-quantity-controls"><button type="button" aria-label="Decrease quantity" data-pos-qty="-1" data-pos-id="'+esc(String(line.product_id))+'">−</button><span>'+line.quantity+'</span><button type="button" aria-label="Increase quantity" data-pos-qty="1" data-pos-id="'+esc(String(line.product_id))+'" '+(line.quantity>=Number(line.product.quantity)?"disabled":"")+'>+</button><button type="button" class="pos-remove" data-pos-remove="'+esc(String(line.product_id))+'">Remove</button></div></div>').join(""):'<div class="empty-state"><h3>Your cart is empty</h3><p>Add products to begin a sale.</p></div>';
    const total=details.reduce((sum,line)=>sum+line.lineTotal,0);
    $("posSubtotal").textContent=money(total);$("posTotal").textContent=money(total);
    $("posCompleteBtn").disabled=!details.length;
  }
  $("posSearch").addEventListener("input",renderPos);
  $("posProductResults").addEventListener("click",e=>{
    const button=e.target.closest("[data-add-pos]");if(!button)return;
    const id=button.dataset.addPos,p=products.find(x=>String(x.id)===String(id));if(!p)return;
    const line=posCart.find(x=>String(x.product_id)===String(id));
    if(line){if(line.quantity>=Number(p.quantity)){toast("No more stock is available for "+p.name+".");return;}line.quantity++;}
    else posCart.push({product_id:p.id,quantity:1});
    $("posMessage").textContent="";renderPos();
  });
  $("posCartItems").addEventListener("click",e=>{
    const remove=e.target.closest("[data-pos-remove]"),qty=e.target.closest("[data-pos-qty]");
    if(remove){posCart=posCart.filter(x=>String(x.product_id)!==String(remove.dataset.posRemove));renderPos();return;}
    if(qty){const line=posCart.find(x=>String(x.product_id)===String(qty.dataset.posId)),p=products.find(x=>String(x.id)===String(qty.dataset.posId));if(!line||!p)return;
      const next=line.quantity+Number(qty.dataset.posQty);if(next<1)posCart=posCart.filter(x=>String(x.product_id)!==String(qty.dataset.posId));else if(next<=Number(p.quantity))line.quantity=next;else toast("Quantity exceeds available stock.");renderPos();}
  });
  $("clearPosCartBtn").addEventListener("click",()=>{posCart=[];$("posMessage").textContent="";renderPos();});
  $("posCheckoutForm").addEventListener("submit",async e=>{
    e.preventDefault();const details=posCartDetails(),message=$("posMessage"),button=$("posCompleteBtn");
    if(!details.length){message.textContent="Add at least one product to the cart.";return;}
    for(const line of details){if(line.quantity<1||line.quantity>Number(line.product.quantity)){message.textContent="Stock changed for "+line.product.name+". Refresh and review the cart.";return;}}
    const customer=$("posCustomer").value.trim()||"Walk-in customer",note=$("posNote").value.trim(),paymentMethod=$("posPaymentMethod").value;
    button.disabled=true;button.textContent="Processing sale…";message.textContent="";
    try{
      let receipt;
      if(localMode){
        const createdAt=new Date().toISOString(),receiptNo="ES-"+createdAt.replace(/[-:TZ.]/g,"").slice(0,14)+"-"+Math.random().toString(36).slice(2,8).toUpperCase();
        const lines=details.map(line=>{const p=line.product,qty=line.quantity;return{id:crypto.randomUUID(),owner_id:session?.user?.id||null,product_id:p.id,product_name:p.name,brand:p.brand||null,model:p.model||null,quantity:qty,unit_purchase_price:Number(p.purchase_price||0),unit_selling_price:Number(p.selling_price||0),total_amount:Number(p.selling_price||0)*qty,gross_profit:(Number(p.selling_price||0)-Number(p.purchase_price||0))*qty,customer_name:customer,note:note||null,receipt_number:receiptNo,transaction_ref:receiptNo,payment_method:paymentMethod,created_at:createdAt};});
        for(const line of details){const p=line.product;products=products.map(x=>String(x.id)===String(p.id)?{...x,quantity:Number(x.quantity)-line.quantity}:x);movements.unshift({id:crypto.randomUUID(),product_id:p.id,product_name:p.name,movement_type:"sale",quantity_change:-line.quantity,note:"Receipt: "+receiptNo+" | "+paymentMethod,created_at:createdAt});}
        sales.unshift(...lines);saveLocal();
        receipt={receipt_number:receiptNo,transaction_ref:receiptNo,customer_name:customer,payment_method:paymentMethod,created_at:createdAt,total_amount:lines.reduce((s,x)=>s+x.total_amount,0),gross_profit:lines.reduce((s,x)=>s+x.gross_profit,0),items:lines};
      }else{
        const {data,error}=await supabase.rpc("record_sale_cart",{p_items:details.map(line=>({product_id:line.product.id,quantity:line.quantity})),p_customer_name:customer,p_note:note||null,p_payment_method:paymentMethod});
        if(error)throw error;
        receipt=data;await loadCloud();
      }
      posCart=[];$("posCustomer").value="";$("posNote").value="";renderAll();renderPos();
      message.textContent="Sale recorded successfully.";toast("Sale recorded and stock updated.");showReceipt(receipt);switchView("sales");
    }catch(error){message.textContent=error?.message||"Could not complete the sale. Please try again.";}
    finally{button.textContent="Complete sale";renderPos();}
  });
  $("refreshBtn").addEventListener("click",async()=>{if(localMode)readLocal();else await loadCloud();renderAll();toast("Inventory refreshed.");});
  $("enableNotificationsBtn").addEventListener("click",()=>{
    const panel=$("notificationPanel"),willOpen=panel.classList.contains("hidden");
    panel.classList.toggle("hidden",!willOpen);
    $("enableNotificationsBtn").setAttribute("aria-expanded",String(willOpen));
    if(willOpen){notificationItems.forEach(n=>n.read=true);unreadNotificationCount=0;saveNotifications();renderNotifications();}
  });
  $("allowBrowserNotificationsBtn").addEventListener("click",requestBrowserNotifications);
  $("clearNotificationsBtn").addEventListener("click",()=>{notificationItems.length=0;unreadNotificationCount=0;saveNotifications();renderNotifications();});
  $("notificationList").addEventListener("click",e=>{
    const item=e.target.closest("[data-notification-index]");if(!item)return;
    const notification=notificationItems[Number(item.dataset.notificationIndex)];
    if(!notification)return;
    notification.read=true;unreadNotificationCount=notificationItems.filter(n=>!n.read).length;saveNotifications();renderNotifications();
    if(notification.kind==="subscription"){
      closeNotificationPanel();
      if(currentRole!=="owner"){toast("Ask the store owner to manage the subscription.");return;}
      switchView("settings");
      const card=$("logoSubscriptionCard");
      if(card)card.scrollIntoView({behavior:"smooth",block:"center"});
      if(hasActiveLogoSubscription()){
        toast("Your logo subscription is already active.");
      }else{
        // Navigate to the subscription card only. Do not trigger Paystack programmatically:
        // browsers can open a blank checkout page when a popup is launched this way.
        toast("Subscription options are ready. Select Subscribe to continue to secure checkout.");
      }
    }
  });
  document.addEventListener("click",e=>{if(!e.target.closest(".notification-wrap"))closeNotificationPanel();});

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
    else{const {error}=await supabase.from("products").update({quantity:updated.quantity}).eq("id",id);if(error){$("stockMessage").textContent=error.message;return;}const {error:me}=await supabase.from("stock_movements").insert({owner_id:session.user.id,product_id:id,movement_type:type,quantity_change:delta,note:note||null});if(me){toast("Quantity updated, but movement log failed: "+me.message);}await loadCloud();}
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