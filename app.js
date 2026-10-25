(() => {
  const $ = (id) => document.getElementById(id);
  const config = window.ELECTROSTOCK_CONFIG || {};
  const configured = config.supabaseUrl && config.supabaseAnonKey &&
    !config.supabaseUrl.includes("YOUR_") && !config.supabaseAnonKey.includes("YOUR_");
  let supabase = null, session = null, products = [], movements = [], sales = [], posCart = [], localMode = !configured;
  const defaultSettings = {company_name:"ElectroStock", phone:"", email:"", address:"", currency:"NGN", logo_url:"", receipt_footer:"Thank you for your patronage!"};
  let companySettings = {...defaultSettings};
  const money = n => new Intl.NumberFormat("en",{style:"currency",currency:companySettings.currency||"NGN",maximumFractionDigits:2}).format(Number(n)||0);
  const fmtDate = d => new Date(d).toLocaleDateString("en-NG",{day:"numeric",month:"short",year:"numeric"});
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const statusOf = p => Number(p.quantity) <= 0 ? "out" : Number(p.quantity) <= Number(p.low_stock_threshold ?? 3) ? "low" : "in";
  const statusText = s => ({in:"In stock",low:"Low stock",out:"Out of stock"}[s]);
  const iconFor = cat => ({Phones:"▯",Laptops:"▣",Accessories:"⌁",Audio:"♫",Gaming:"◈",Televisions:"▭",Networking:"⌘",Storage:"▤",Power:"ϟ",Electronics:"▤",Groceries:"▦","Drinks and Beverages":"◉","Food and Snacks":"◇","Household Items":"⌂","Personal Care":"✦","Fashion and Clothing":"◇","Shoes and Bags":"◈","Beauty and Cosmetics":"✦","Health Products":"＋","Hardware and Building Materials":"⚒","Stationery and Books":"▤","Automotive Parts":"⚙"}[cat] || "▤");
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
  function openPasswordReset(){$("resetPasswordMessage").textContent="";$("resetPasswordModal").classList.remove("hidden");document.body.style.overflow="hidden";}
  async function init(){
    $("todayLabel").textContent=new Date().toLocaleDateString("en-NG",{weekday:"short",day:"numeric",month:"short",year:"numeric"});
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
        if(callbackStatus==="verified")toast("Email verified successfully. Welcome to ElectroStock.");
      }else{
        showAuth();
        if(callbackStatus==="verified"){setAuthMode("login");authMessage("Email verified successfully. Please sign in to continue.");}
        else if(callbackError){authMessage("Authentication link error: "+callbackError.replace(/\+/g," "));}
      }
      if(callbackStatus||callbackError){
        const cleanUrl=window.location.pathname+window.location.hash;
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
      const {data,error}=await supabase.auth.signUp({email,password,options:{data:{full_name:fullName},emailRedirectTo:window.location.origin+"/?auth=verified"}});
      $("loginBtn").disabled=false;$("loginBtn").textContent="Create account";
      if(error){authMessage(error.message);return;}
      if(data.session){session=data.session;showApp();await loadCloud();}
      else {setAuthMode("login");$("email").value=email;authMessage("Account created. Check your email for the verification link, then return here and sign in.");}
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
  $("logoutBtn").addEventListener("click",async()=>{if(supabase&&!localMode)await supabase.auth.signOut();session=null;showAuth();setAuthMode("login");});
  async function loadCloud(){
    if(localMode)return;
    const [pr,mv,sv,cs]=await Promise.all([
      supabase.from("products").select("*").order("created_at",{ascending:false}),
      supabase.from("stock_movements").select("*, products(name)").order("created_at",{ascending:false}).limit(300),
      supabase.from("sales").select("*").order("created_at",{ascending:false}).limit(1000),
      supabase.from("company_settings").select("*").eq("owner_id",session.user.id).maybeSingle()
    ]);
    if(pr.error){products=[];toast("Products could not load: "+pr.error.message);}else products=pr.data||[];
    if(mv.error){movements=[];toast("Stock movements could not load: "+mv.error.message);}else movements=(mv.data||[]).map(m=>({...m,product_name:m.products?.name||"Deleted product"}));
    if(sv.error){sales=[];toast("Sales history needs attention: "+sv.error.message);}else sales=sv.data||[];
    companySettings={...defaultSettings,...(cs?.data||{})};
    renderAll();applyCompanyBranding();populateSettingsForm();
    if(cs?.error){console.error("Company settings could not be checked:",cs.error.message);}
    if(!cs?.data && session?.user?.id){openOnboarding();}
  }
  async function saveProduct(data,id){
    if(localMode){
      if(id){products=products.map(p=>p.id===id?{...p,...data,updated_at:new Date().toISOString()}:p);}
      else products.unshift({...data,id:crypto.randomUUID(),created_at:new Date().toISOString()});
      saveLocal();return {error:null};
    }
    const result=id?await supabase.from("products").update(data).eq("id",id).select().single():await supabase.from("products").insert({...data,owner_id:session.user.id}).select().single();
    return result;
  }
  async function deleteProduct(id){
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
    $("productsTable").innerHTML=list.map(p=>productRow(p)).join("");$("emptyProducts").classList.toggle("hidden",list.length>0);
    const cats=[...new Set(products.map(p=>p.category).filter(Boolean))].sort(),current=$("categoryFilter").value;
    $("categoryFilter").innerHTML='<option value="">All categories</option>'+cats.map(c=>`<option ${c===current?"selected":""}>${esc(c)}</option>`).join("");
    $("productsTable").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>openModal(b.dataset.edit)));
    $("productsTable").querySelectorAll("[data-delete]").forEach(b=>b.addEventListener("click",()=>deleteProduct(b.dataset.delete)));
  }
  function renderRecent(){const list=[...products].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,5);$("recentProducts").innerHTML=list.length?`<table><thead><tr><th>PRODUCT</th><th>SELL PRICE</th><th>QUANTITY</th><th>STATUS</th></tr></thead><tbody>${list.map(p=>`<tr><td>${productCell(p)}</td><td>${money(p.selling_price)}</td><td>${Number(p.quantity)||0}</td><td>${statusBadge(p)}</td></tr>`).join("")}</tbody></table>`:'<div class="empty-state"><div class="empty-icon">▤</div><h3>Your catalogue starts here</h3><p>Add your products to see them listed here.</p><button class="btn primary" id="recentAddBtn">＋ Add product</button></div>';const b=$("recentAddBtn");if(b)b.addEventListener("click",()=>openModal());}
  function renderAlerts(){const list=products.filter(p=>statusOf(p)!=="in").sort((a,b)=>Number(a.quantity)-Number(b.quantity)).slice(0,6);$("alertsList").innerHTML=list.length?list.map(p=>`<div class="alert-item"><div class="product-thumb">${p.image_url?`<img src="${esc(p.image_url)}" alt="">`:iconFor(p.category)}</div><div class="alert-info"><strong>${esc(p.name)}</strong><small>${esc(p.category||"Uncategorized")} · Reorder at ${Number(p.low_stock_threshold??3)}</small></div><span class="qty-badge ${statusOf(p)}">${statusOf(p)==="out"?"Out of stock":`${p.quantity} left`}</span></div>`).join(""):'<div class="empty-state"><div class="empty-icon">✓</div><h3>All clear</h3><p>No low-stock or out-of-stock alerts.</p></div>';}
  function renderProductOptions(){const current=$("stockProduct").value;$("stockProduct").innerHTML='<option value="">Select a product</option>'+products.map(p=>`<option value="${p.id}" ${p.id===current?"selected":""}>${esc(p.name)} (${p.quantity} available)</option>`).join("");}
  function renderMovements(){const rows=movements.slice(0,100);$("movementTable").innerHTML=rows.map(m=>`<tr><td>${fmtDate(m.created_at||new Date())}</td><td>${esc(m.product_name||products.find(p=>p.id===m.product_id)?.name||"Product")}</td><td>${esc(({purchase:"Purchase",adjustment:"Adjustment",sale:"Sale"}[m.movement_type]||m.movement_type||"Movement"))}</td><td style="color:${Number(m.quantity_change)>=0?"#78dfb4":"#ff9ba7"}">${Number(m.quantity_change)>0?"+":""}${Number(m.quantity_change)}</td><td>${esc(m.note||"—")}</td></tr>`).join("");$("emptyMovements").classList.toggle("hidden",rows.length>0);}
  function switchView(view){document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));$(view+"View").classList.remove("hidden");document.querySelectorAll(".nav-item[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));$("pageTitle").textContent=({dashboard:"Dashboard",products:"Products",pos:"Point of Sale",sales:"Sales management",stock:"Stock movement",settings:"Company settings"}[view]||"Dashboard");$("sidebar").classList.remove("mobile-open");$("mobileMenuBtn").setAttribute("aria-expanded","false");if(view==="settings")populateSettingsForm();}
  document.querySelectorAll(".nav-item[data-view]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
  document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.go)));
  $("addProductTop").addEventListener("click",()=>openModal());$("addProductBtn").addEventListener("click",()=>openModal());$("emptyAddBtn").addEventListener("click",()=>openModal());
  $("searchInput").addEventListener("input",renderProducts);$("categoryFilter").addEventListener("change",renderProducts);$("stockFilter").addEventListener("change",renderProducts);
  $("exportBtn").addEventListener("click",exportInventory);
  $("importBtn").addEventListener("click",()=>{if(!window.XLSX){alert("The Excel import library could not load. Refresh the page and try again.");return;} $("importFileInput").click();});
  $("importFileInput").addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;const btn=$("importBtn");btn.disabled=true;btn.textContent="Importing…";try{await importInventory(file);}catch(error){console.error("ElectroStock import failed:",error);alert("Import failed: "+(error?.message||"Please check your Excel file and try again."));}finally{btn.disabled=false;btn.textContent="↑ Import Excel";e.target.value="";}});
  $("salesSearch").addEventListener("input",renderSales);
  function openSaleForm(){switchView("pos");$("posSearch").focus();$("posMessage").textContent="Add products to the cart to start a sale.";}
  $("recordSaleBtn").addEventListener("click",openSaleForm);$("emptyRecordSaleBtn").addEventListener("click",openSaleForm);
  $("mobileMenuBtn").addEventListener("click",()=>{const open=$("sidebar").classList.toggle("mobile-open");$("mobileMenuBtn").setAttribute("aria-expanded",String(open));$("mobileMenuBtn").textContent=open?"×":"☰";});
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
    const activeLogo=companySettings.logo_url||"";
    const logoMarkup=activeLogo?`<img src="${esc(activeLogo)}" alt="Company logo">`:'E<span>+</span>';
    $("settingsLogoPreview").innerHTML=logoMarkup;$("receiptLogo").innerHTML=logoMarkup;
    ["authBrandLogo","sidebarBrandLogo","mobileBrandLogo"].forEach(id=>{const el=$(id);if(el)el.innerHTML=activeLogo?`<img src="${esc(activeLogo)}" alt="Company logo">`:'E<span>+</span>';});
    document.title=`${name} — Inventory Management`;updateLogoSubscriptionUI();
  }
  function populateSettingsForm(){
    if(!$('settingCompanyName'))return;
    $("settingCompanyName").value=companySettings.company_name||"ElectroStock";$("settingPhone").value=companySettings.phone||"";$("settingEmail").value=companySettings.email||"";$("settingAddress").value=companySettings.address||"";$("settingCurrency").value=companySettings.currency||"NGN";$("settingReceiptFooter").value=companySettings.receipt_footer||"Thank you for your patronage!";
    $("settingsMessage").textContent="";applyCompanyBranding();
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
  function hasActiveLogoSubscription(){return true;}
  function updateLogoSubscriptionUI(){
    const input=$("settingLogoFile"),help=$("logoUploadHelp");
    if(input)input.disabled=false;
    if(help)help.textContent="Upload your business logo. PNG, JPG or WEBP, maximum 2 MB.";
  }
  $("settingCompanyName").addEventListener("input",()=>$("settingsPreviewName").textContent=$("settingCompanyName").value.trim()||"Your company name");
  $("settingLogoFile").addEventListener("change",()=>{const file=$("settingLogoFile").files[0];if(!file)return;if(file.size>2*1024*1024){$("settingsMessage").textContent="Logo must be 2 MB or smaller.";$("settingLogoFile").value="";return;}const url=URL.createObjectURL(file);$("settingsLogoPreview").innerHTML=`<img src="${url}" alt="Logo preview">`;});
  $("settingsForm").addEventListener("submit",async e=>{
    e.preventDefault();const btn=$("saveSettingsBtn"),message=$("settingsMessage");message.textContent="";
    const company_name=$("settingCompanyName").value.trim();if(!company_name){message.textContent="Company name is required.";return;}
    const requestedLogo=$("settingLogoFile").files[0];
    btn.disabled=true;btn.textContent="Saving…";
    let logo_url=companySettings.logo_url||"";const file=$("settingLogoFile").files[0];
    if(file){const uploaded=await uploadCompanyLogo(file);if(uploaded.error){message.textContent=uploaded.error.message.includes("company-logos")?uploaded.error.message+" — run supabase/company_settings_migration.sql first.":uploaded.error.message;btn.disabled=false;btn.textContent="Save company settings";return;}logo_url=uploaded.url||"";}
    const next={company_name,phone:$("settingPhone").value.trim(),email:$("settingEmail").value.trim(),address:$("settingAddress").value.trim(),currency:$("settingCurrency").value,logo_url,receipt_footer:$("settingReceiptFooter").value.trim()||"Thank you for your patronage!"};
    if(localMode){companySettings={...defaultSettings,...next};saveLocal();}
    else {const {error}=await supabase.from("company_settings").upsert({...next,owner_id:session.user.id},{onConflict:"owner_id"});if(error){message.textContent=error.message.includes("company_settings")?error.message+" — run supabase/company_settings_migration.sql in Supabase SQL Editor.":error.message;btn.disabled=false;btn.textContent="Save company settings";return;}companySettings={...defaultSettings,...next};}
    btn.disabled=false;btn.textContent="Save company settings";$("settingLogoFile").value="";applyCompanyBranding();message.textContent="Company settings saved successfully.";toast("Company settings saved.");
  });
  function csvCell(value){const text=String(value??"");return '"'+text.replace(/"/g,'""')+'"';}
  function normalizeImportHeader(value){return String(value??"").trim().toLowerCase().replace(/[()]/g,"").replace(/[^a-z0-9]+/g," ").trim();}
  async function importInventory(file){
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
    const groups=new Map();
    sales.forEach(s=>{
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
  function openModal(id=null){
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
  init();
})();