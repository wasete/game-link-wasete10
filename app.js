(() => {

  // Playful neon cursor that follows the pointer on desktop and shows ripples on touch.
  const orb = document.getElementById('cursorOrb');
  let lastTrail = 0;
  if (orb && window.matchMedia('(pointer:fine)').matches) {
    document.addEventListener('pointermove', (e) => {
      orb.style.left = e.clientX + 'px';
      orb.style.top = e.clientY + 'px';
      orb.classList.add('visible');
      const now = performance.now();
      if (now - lastTrail > 38) {
        lastTrail = now;
        const dot = document.createElement('span');
        dot.className = 'cursor-trail';
        dot.style.left = e.clientX + 'px';
        dot.style.top = e.clientY + 'px';
        document.body.appendChild(dot);
        dot.addEventListener('animationend', () => dot.remove(), {once:true});
      }
    }, {passive:true});
    document.addEventListener('pointerleave', () => orb.classList.remove('visible'));
    document.addEventListener('pointerdown', (e) => {
      const ripple = document.createElement('span');
      ripple.className = 'tap-ripple';
      ripple.style.left = e.clientX + 'px';
      ripple.style.top = e.clientY + 'px';
      document.body.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove(), {once:true});
    }, {passive:true});
  } else {
    document.addEventListener('touchstart', (e) => {
      const touch = e.touches && e.touches[0]; if (!touch) return;
      const ripple = document.createElement('span');
      ripple.className = 'tap-ripple';
      ripple.style.left = touch.clientX + 'px';
      ripple.style.top = touch.clientY + 'px';
      document.body.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove(), {once:true});
    }, {passive:true});
  }

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  let supabase = null, session = null, activeTrade = null, publicChannel = null, tradeChannel = null, isPrimaryAdmin = false, isStaff = false, currentRole='member';
  let demoTrade = null;
  let currentUsername = '';
  let memberProfiles = [];
  const config = window.GAMELINK_CONFIG || {};
  const connected = !!(window.supabase && config.SUPABASE_URL && config.SUPABASE_ANON_KEY);
  if (connected) {
    supabase = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    $('#connectionState').textContent = 'اتصال آماده';
    $('#connectionState').classList.add('connected');
  }

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
  }
  function escapeHTML(s='') {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function fmtTime(d = new Date()) { return d.toLocaleTimeString('fa-IR', {hour:'2-digit', minute:'2-digit'}); }
  let selectedMember = '';
  let selectedMemberId = '';
  let tradeRoomCache = [];
  function messageNode(msg, own=false) {
    const div = document.createElement('div');
    div.className = 'message-row' + (own ? ' own' : '');
    const voiceUrl = (msg.content || '').startsWith('[[VOICE]]') ? (msg.content || '').slice(9) : '';
    const textContent = voiceUrl ? '' : (msg.content || '');
    const image = msg.image_url ? `<a class="chat-image-link" href="${escapeHTML(msg.image_url)}" target="_blank" rel="noopener"><img class="chat-image" src="${escapeHTML(msg.image_url)}" alt="عکس ارسال‌شده در چت" loading="lazy"></a>` : '';
    const voice = voiceUrl ? `<audio controls preload="none" src="${escapeHTML(voiceUrl)}"></audio>` : '';
    const controls = msg.id && msg.table ? `<div class="message-tools">${own ? `<button type="button" class="tiny-btn message-edit">ویرایش</button><button type="button" class="tiny-btn message-delete">حذف</button>` : ''}${isPrimaryAdmin && msg.table === 'public_messages' ? `<button type="button" class="tiny-btn admin-delete-public-message">حذف پیام (مدیر)</button>` : ''}</div>` : '';
    div.innerHTML = `<button type="button" class="msg-avatar profile-trigger" data-username="${escapeHTML(msg.username || 'عضو')}" title="نمایش پروفایل">${escapeHTML((msg.username || 'G').slice(0,1).toUpperCase())}</button><div class="msg-content"><div class="msg-meta"><button type="button" class="profile-name profile-trigger" data-username="${escapeHTML(msg.username || 'عضو')}">${escapeHTML(msg.username || 'عضو')}</button><time>${escapeHTML(msg.time || fmtTime(msg.created_at ? new Date(msg.created_at) : new Date()))}</time></div>${textContent ? `<div class="bubble">${escapeHTML(textContent)}</div>` : ''}${image}${voice}${controls}</div>`;
    return div;
  }
  function openMemberProfile(username, userId='') {
    if (!username || userId === session?.id || username === (session?.user_metadata?.username || session?.email?.split('@')[0])) return;
    selectedMember = username;
    selectedMemberId = userId || memberProfiles.find(p => p.username === username)?.id || '';
    $('#memberModalName').textContent = username;
    $('#memberAdminActions').hidden = !isStaff || !selectedMemberId;
    $('#memberModal').hidden = false;
  }
  $('#closeMemberModal').addEventListener('click', () => $('#memberModal').hidden = true);
  $('#memberModal').addEventListener('click', e => { if (e.target === $('#memberModal')) $('#memberModal').hidden = true; });
  $('#goToDMBtn').addEventListener('click', () => { $('#memberModal').hidden = true; openDM(selectedMember); });
  $('#adminBanMemberBtn')?.addEventListener('click', async () => {
    if (!isStaff || !selectedMemberId || !supabase) return;
    if (!confirm(`عضو «${selectedMember}» از دسترسی سایت محروم شود؟`)) return;
    const {error}=await supabase.rpc('admin_ban_member', {target_user_id:selectedMemberId});
    if(error){toast('اخراج عضو ناموفق بود: '+error.message);return;}
    toast('دسترسی عضو مسدود شد.'); $('#memberModal').hidden=true; await loadMembers();
  });
  document.addEventListener('click', e => { const b=e.target.closest('.profile-trigger'); if (b) openMemberProfile(b.dataset.username, b.dataset.userId || ''); });
  async function uploadChatImage(input) {
    const file = input.files?.[0]; if (!file) return null;
    if (!session || !supabase) { toast('برای ارسال عکس اول وارد حساب شو.'); input.value=''; return null; }
    if (!file.type.startsWith('image/')) { toast('فقط فایل عکس مجاز است.'); input.value=''; return null; }
    if (file.size > 5*1024*1024) { toast('حجم عکس باید کمتر از ۵ مگابایت باشد.'); input.value=''; return null; }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${session.id}/${Date.now()}-${safeName}`;
    const {error} = await supabase.storage.from('chat-images').upload(path, file, {upsert:false, contentType:file.type});
    if (error) { toast('آپلود عکس ناموفق بود: '+error.message+'؛ SQL تنظیمات عکس را اجرا کن.'); input.value=''; return null; }
    const {data} = supabase.storage.from('chat-images').getPublicUrl(path);
    input.value=''; return data.publicUrl;
  }
  function showImagePreview(previewId, inputId, file) {
    const wrap = document.getElementById(previewId); if (!wrap) return;
    wrap.replaceChildren();
    if (!file) { wrap.hidden = true; return; }
    const thumb = document.createElement('img'); thumb.className = 'composer-image-thumb'; thumb.alt = 'پیش‌نمایش عکس انتخاب‌شده'; thumb.src = URL.createObjectURL(file);
    const info = document.createElement('div'); info.className = 'composer-image-info';
    const title = document.createElement('b'); title.textContent = file.name || 'عکس انتخاب‌شده';
    const hint = document.createElement('small'); hint.textContent = 'عکس آمادهٔ ارسال است'; info.append(title, hint);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-image-preview'; remove.textContent = '×'; remove.setAttribute('aria-label','حذف عکس انتخاب‌شده');
    remove.addEventListener('click', () => { const picker = document.getElementById(inputId); if (picker) picker.value=''; const msgInput = document.getElementById(inputId === 'publicImageInput' ? 'publicInput' : inputId === 'dmImageInput' ? 'dmInput' : 'tradeInput'); if(msgInput) delete msgInput.dataset.imageUrl; showImagePreview(previewId,inputId,null); });
    wrap.append(thumb, info, remove); wrap.hidden = false;
  }
  $('#publicImageInput').addEventListener('change', async e => { const file=e.target.files?.[0]; if(file) showImagePreview('publicImagePreview','publicImageInput',file); const url=await uploadChatImage(e.target); if(url){$('#publicInput').dataset.imageUrl=url;toast('عکس آماده ارسال است؛ دکمه ارسال را بزن.');} else if(!e.target.files?.length) showImagePreview('publicImagePreview','publicImageInput',null); });
  $('#dmImageInput').addEventListener('change', async e => { const file=e.target.files?.[0]; if(file) showImagePreview('dmImagePreview','dmImageInput',file); const url=await uploadChatImage(e.target); if(url){$('#dmInput').dataset.imageUrl=url;toast('عکس آماده ارسال است؛ دکمه ارسال را بزن.');} else if(!e.target.files?.length) showImagePreview('dmImagePreview','dmImageInput',null); });
  function addMessage(container, msg, own=false) {
    const welcome = container.querySelector('.welcome-card'); if (welcome) welcome.remove();
    container.appendChild(messageNode(msg, own)); container.scrollTop = container.scrollHeight;
  }
  function setUser(user) {
    session = user;
    const name = user ? (currentUsername || user.user_metadata?.username || user.email?.split('@')[0] || 'عضو') : 'مهمان';
    $('#userLabel').textContent = name;
    $('#userStatus').textContent = user ? 'عضو GameLink' : 'برای چت وارد شو';
    $('#myAvatar').textContent = name.slice(0,1).toUpperCase();
    $('#profileAvatar').textContent = name.slice(0,1).toUpperCase();
    $('#profileName').textContent = user ? name : 'مهمان GameLink';
    $('#profileEmail').textContent = user?.email || 'برای استفاده از چت وارد شو.';
    $('#authBtn').textContent = user ? 'خروج' : 'ورود';
    $('#profileAuthBtn').textContent = user ? 'خروج از حساب' : 'ورود / ثبت‌نام';
    $('#publicInput').disabled = !user;
    $('#publicInput').placeholder = user ? 'پیامت رو بنویس...' : 'برای ارسال پیام ابتدا وارد شو';
    $('#publicForm').querySelector('button[type="submit"]').disabled = !user;
    if (user) checkAdmin();
    else { $('#adminNav').hidden = true; $('#lotteryNav').hidden = true; isStaff=false; isPrimaryAdmin=false; }
  }
  async function checkAdmin() {
    if (!supabase || !session) return;
    const {data,error} = await supabase.from('profiles').select('role').eq('id', session.id).maybeSingle();
    currentRole=data?.role||'member'; isPrimaryAdmin=currentRole==='admin'; isStaff=['admin','assistant'].includes(currentRole);
    $('#adminNav').hidden = !isStaff; $('#lotteryNav').hidden = !isStaff && !lotteryIsActive;
    const roleNotice=$('#detectedRoleNotice'); if(roleNotice) roleNotice.textContent=error ? 'تشخیص نقش ناموفق بود؛ مجوزهای profiles را بررسی کن.' : `نقش فعلی این حساب در دیتابیس: ${currentRole==='admin'?'مدیر':currentRole==='assistant'?'دستیار':'عضو عادی'}. اگر مدیر هستی و اینجا «عضو عادی» می‌بینی، role حساب در جدول profiles باید اصلاح شود.`;
    const createCard=$('#createTradeForm')?.closest('.rail-card'); if(createCard) createCard.hidden=!isPrimaryAdmin;
    refreshLottery(); refreshListingsState();
  }
  function navigate(view) {
    if(view==='admin' && !isStaff){toast('این بخش فقط برای مدیر و دستیار است.');return;}
    if(view==='lottery' && !isStaff && !lotteryIsActive){toast('قرعه‌کشی هنوز توسط مدیر فعال نشده است.');return;}
    $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    $$('.nav-item').forEach(v => v.classList.toggle('active', v.dataset.view === view));
    const titles = {public:'چت عمومی', market:'بازار اکانت‌ها', inbox:'پیام‌ها', trades:'اتاق‌های معامله', members:'اعضای سایت', profile:'پروفایل', admin:'پنل مدیریت', lottery:'قرعه‌کشی اکانت'};
    if (view === 'inbox') loadInbox();
    if (view === 'members') loadMembers();
    if (view === 'admin' && isStaff) { loadAdminTradeRooms(); refreshLottery(); refreshListingsState(); }
    if (view === 'lottery') refreshLottery();
    if (view === 'profile' && session) $('#newUsername').value = currentUsername || session.user_metadata?.username || session.email?.split('@')[0] || '';
    $('#pageTitle').textContent = titles[view] || 'GameLink';
  }
  $$('.nav-item').forEach(b => b.addEventListener('click', () => navigate(b.dataset.view)));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.goto)));
  async function loadMembers() {
    const grid = $('#membersGrid');
    if (!supabase || !session) { grid.innerHTML='<div class="rail-card">برای دیدن اعضا ابتدا وارد حساب شو.</div>'; $('#membersCount').textContent='—'; return; }
    grid.innerHTML='<div class="rail-card">در حال بارگذاری اعضا…</div>';
    const {data,error}=await supabase.from('profiles').select('id,username,created_at,role').order('created_at',{ascending:false}).limit(500);
    if(error){grid.innerHTML='<div class="rail-card">بارگذاری اعضا ناموفق بود: '+escapeHTML(error.message)+'</div>';return;}
    memberProfiles=data||[]; $('#membersCount').textContent=`${memberProfiles.length.toLocaleString('fa-IR')} عضو`;
    renderMembers($('#memberSearch').value||'');
  }
  function renderMembers(query='') {
    const grid=$('#membersGrid'); const q=query.trim().toLocaleLowerCase();
    const rows=memberProfiles.filter(p=>(p.username||'عضو').toLocaleLowerCase().includes(q));
    if(!rows.length){grid.innerHTML='<div class="rail-card">عضوی با این نام پیدا نشد.</div>';return;}
    grid.innerHTML=rows.map(p=>`<button type="button" class="member-card profile-trigger" data-user-id="${escapeHTML(p.id)}" data-username="${escapeHTML(p.username||'عضو')}" style="text-align:right;color:inherit;cursor:pointer"><span class="member-card-avatar">${escapeHTML((p.username||'ع').slice(0,1).toUpperCase())}</span><span><span class="member-card-name">${escapeHTML(p.username||'عضو')}</span><span class="member-card-meta">${p.role==='admin'?'مدیر سایت':p.role==='assistant'?'دستیار':'عضو GameLink'}</span></span></button>`).join('');
  }
  $('#memberSearch').addEventListener('input',e=>renderMembers(e.target.value));
  $('#profilePhotoInput')?.addEventListener('change', async e=>{const f=e.target.files?.[0];if(!f)return;if(!session||!supabase){toast('ابتدا وارد حساب شو.');return;}if(!f.type.startsWith('image/')||f.size>5*1024*1024){toast('یک عکس کمتر از ۵ مگابایت انتخاب کن.');e.target.value='';return;}const path=`${session.id}/avatar-${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;const {error}=await supabase.storage.from('chat-images').upload(path,f,{upsert:true,contentType:f.type});if(error){toast('آپلود عکس پروفایل ناموفق بود: '+error.message);return;}const {data}=supabase.storage.from('chat-images').getPublicUrl(path);const {error:pe}=await supabase.from('profiles').update({avatar_url:data.publicUrl}).eq('id',session.id);if(pe){toast('ذخیره عکس پروفایل ناموفق بود؛ SQL جدید را اجرا کن.');return;}$('#profileAvatar').innerHTML=`<img src="${escapeHTML(data.publicUrl)}" alt="عکس پروفایل">`;$('#myAvatar').innerHTML=`<img src="${escapeHTML(data.publicUrl)}" alt="عکس پروفایل">`;toast('عکس پروفایل ذخیره شد.');e.target.value='';});
  $('#usernameForm').addEventListener('submit',async e=>{
    e.preventDefault(); const name=$('#newUsername').value.trim(); const result=$('#usernameResult');
    if(!session||!supabase){result.textContent='برای تغییر نام ابتدا وارد حساب شو.';return;}
    if(name.length<3||name.length>24){result.textContent='نام باید بین ۳ تا ۲۴ حرف باشد.';return;}
    if(!/^[\p{L}\p{N}_ .-]+$/u.test(name)){result.textContent='از حروف، عدد، فاصله، نقطه، خط تیره یا زیرخط استفاده کن.';return;}
    result.textContent='در حال ذخیره…';
    const {error}=await supabase.from('profiles').update({username:name}).eq('id',session.id);
    if(error){result.textContent='ذخیره نام ناموفق بود: '+error.message;return;}
    currentUsername=name; $('#userLabel').textContent=name; $('#myAvatar').textContent=name.slice(0,1).toUpperCase(); $('#profileName').textContent=name; $('#profileAvatar').textContent=name.slice(0,1).toUpperCase();
    await supabase.auth.updateUser({data:{username:name}}); result.textContent='نام کاربری ذخیره شد.'; toast('نام کاربری به‌روزرسانی شد.');
    if(memberProfiles.some(p=>p.id===session.id)){memberProfiles=memberProfiles.map(p=>p.id===session.id?{...p,username:name}:p);renderMembers($('#memberSearch').value||'');}
  });

  $('#themeBtn').addEventListener('click', toggleTheme);
  $('#themeBtnTop').addEventListener('click', toggleTheme);
  function toggleTheme() {
    const isDark = document.body.classList.toggle('dark');
    localStorage.setItem('gamelink-theme', isDark ? 'dark' : 'light');
    $('#themeBtn').textContent = isDark ? '☀️ تم روشن' : '🌙 تم نئونی';
  }
  if (localStorage.getItem('gamelink-theme') === 'dark') document.body.classList.add('dark');

  function openAuth() { $('#authModal').hidden = false; $('#authResult').textContent = ''; }
  function closeAuth() { $('#authModal').hidden = true; }
  $('#authBtn').addEventListener('click', async () => {
    if (session && supabase) { await supabase.auth.signOut(); setUser(null); toast('از حساب خارج شدی.'); }
    else openAuth();
  });
  $('#profileAuthBtn').addEventListener('click', async () => {
    if (session && supabase) { await supabase.auth.signOut(); setUser(null); toast('از حساب خارج شدی.'); }
    else openAuth();
  });
  $('#closeAuth').addEventListener('click', closeAuth);
  $('#authModal').addEventListener('click', e => { if (e.target === $('#authModal')) closeAuth(); });
  async function auth(mode) {
    const email = $('#authEmail').value.trim(), password = $('#authPassword').value;
    if (!supabase) { $('#authResult').textContent = 'برای ورود واقعی، ابتدا Supabase را در config.js تنظیم کن. در حال حاضر سایت در حالت نمایشی است.'; return; }
    $('#authResult').textContent = 'در حال انجام...';
    const result = mode === 'signup'
      ? await supabase.auth.signUp({email, password, options:{data:{username:email.split('@')[0]}}})
      : await supabase.auth.signInWithPassword({email, password});
    if (result.error) { $('#authResult').textContent = result.error.message; return; }
    if (mode === 'signup' && !result.data.session) $('#authResult').textContent = 'حساب ساخته شد. ایمیلت را برای تأیید بررسی کن، سپس وارد شو.';
    else { setUser(result.data.user); closeAuth(); toast('با موفقیت وارد شدی.'); loadPublicMessages(); }
  }
  $('#authForm').addEventListener('submit', e => { e.preventDefault(); auth('signin'); });
  $('#signUpBtn').addEventListener('click', () => auth('signup'));

  async function loadPublicMessages() {
    const box = $('#publicMessages');
    if (!supabase) return;
    const {data, error} = await supabase.from('public_messages').select('id, user_id, username, content, image_url, created_at').order('created_at', {ascending:true}).limit(100);
    if (error) { toast('بارگذاری پیام‌ها ناموفق بود. تنظیمات دیتابیس را بررسی کن.'); return; }
    box.innerHTML = '';
    if (!data.length) box.innerHTML = '<div class="welcome-card"><div class="welcome-emoji">👋</div><h3>اولین پیام رو تو بفرست!</h3><p>چت عمومی آماده است.</p></div>';
    data.forEach(m => { const n=messageNode({...m, table:'public_messages', time:fmtTime(new Date(m.created_at))}, m.user_id === session?.id); n.dataset.id=m.id; n.dataset.table='public_messages'; box.appendChild(n); });
    if (publicChannel) supabase.removeChannel(publicChannel);
    publicChannel = supabase.channel('public-room').on('postgres_changes', {event:'INSERT', schema:'public', table:'public_messages'}, payload => {
      const m = payload.new;
      if (!box.querySelector(`[data-id="${m.id}"]`)) {
        const node = messageNode({...m, table:'public_messages', time:fmtTime(new Date(m.created_at))}, m.user_id === session?.id);
        node.dataset.id = m.id; node.dataset.table='public_messages';
        const welcome = box.querySelector('.welcome-card'); if (welcome) welcome.remove();
        box.appendChild(node); box.scrollTop = box.scrollHeight;
      }
    }).subscribe();
  }
  $('#publicForm').addEventListener('submit', async e => {
    e.preventDefault();
    const content = $('#publicInput').value.trim(); const image_url=$('#publicInput').dataset.imageUrl || null; if (!content && !image_url) return;
    if (!session) { openAuth(); return; }
    if (!supabase) { toast('برای ارسال واقعی پیام، Supabase را تنظیم کن.'); return; }
    const username = session.user_metadata?.username || session.email.split('@')[0];
    const {error} = await supabase.from('public_messages').insert({user_id:session.id, username, content, image_url});
    if (error) toast('پیام ارسال نشد: ' + error.message);
    else { $('#publicInput').value = ''; delete $('#publicInput').dataset.imageUrl; showImagePreview('publicImagePreview','publicImageInput',null); }
  });
  $('#emojiBtn').addEventListener('click', () => { const i=$('#publicInput'); i.value += ' 😊'; i.focus(); });

  async function refreshListingsState() {
    if (!supabase) return;
    const {data,error}=await supabase.from('site_settings').select('listings_active').eq('id',1).maybeSingle();
    if (error) { toast('تنظیمات آگهی‌ها خوانده نشد؛ SQL آگهی‌ها را اجرا کن.'); return; }
    listingsAreActive=!!data?.listings_active;
    const btn=$('#newListingBtn'); if(btn) btn.hidden=!isStaff && !listingsAreActive;
    const notice=$('#listingAvailabilityNotice'); if(notice) notice.hidden=listingsAreActive || isStaff;
    const toggle=$('#toggleListingsBtn'); if(toggle) toggle.textContent=listingsAreActive?'غیرفعال کردن بخش آگهی‌ها':'فعال کردن بخش آگهی‌ها';
    const status=$('#listingAdminStatus'); if(status) status.textContent=listingsAreActive?'وضعیت بخش آگهی‌ها: فعال':'وضعیت بخش آگهی‌ها: غیرفعال';
    if(isStaff) await loadAdminListings();
  }
  async function createListing({admin=false, existing=null}={}) {
    if (!session || !supabase) { if(!session) openAuth(); else toast('اتصال Supabase در دسترس نیست.'); return; }
    if (!isStaff && !listingsAreActive) { toast('بخش آگهی‌ها هنوز توسط مدیر فعال نشده است.'); return; }
    const title=prompt('عنوان آگهی:', existing?.title || ''); if(!title?.trim()) return;
    const game=prompt('نام بازی:', existing?.game || 'بازی') || 'بازی';
    const description=prompt('توضیحات آگهی:', existing?.description || 'برای جزئیات بیشتر پیام بده.') || '';
    const payload={title:title.trim(),game:game.trim(),description:description.trim(),status:'active'};
    let result;
    if(existing) result=await supabase.from('listings').update(payload).eq('id',existing.id);
    else result=await supabase.from('listings').insert({...payload,user_id:session.id});
    if(result.error){toast((existing?'ویرایش':'ثبت')+' آگهی ناموفق بود: '+result.error.message);return;}
    toast(existing?'آگهی ویرایش شد.':'آگهی ثبت شد.'); await loadListings(); if(isStaff) await loadAdminListings();
  }
  $('#newListingBtn').addEventListener('click', () => createListing());
  $('#adminAddListingBtn')?.addEventListener('click', () => { if(!isStaff){toast('این قابلیت فقط برای مدیر و دستیار است.');return;} createListing({admin:true}); });
  $('#toggleListingsBtn')?.addEventListener('click', async()=>{
    if(!isStaff||!supabase){toast('فقط مدیر و دستیار می‌توانند بخش آگهی‌ها را فعال کنند.');return;}
    const {error}=await supabase.from('site_settings').upsert({id:1,listings_active:!listingsAreActive},{onConflict:'id'});
    if(error){toast('تغییر وضعیت آگهی‌ها ناموفق بود: '+error.message);return;}
    await refreshListingsState(); await loadListings();
  });
  async function loadListings() {
    if (!supabase) return;
    const {data,error}=await supabase.from('listings').select('id,user_id,title,game,description,status,created_at').eq('status','active').order('created_at',{ascending:false}).limit(50);
    if (error || !data) { if(error) console.warn('loadListings:',error.message); return; }
    const grid=$('#marketGrid'); grid.innerHTML='';
    if (!data.length) { grid.innerHTML='<div class="rail-card">هنوز آگهی‌ای ثبت نشده است.</div>'; return; }
    data.forEach((x,i) => {
      const article=document.createElement('article'); article.className='listing-card';
      const staffTools=isStaff?`<div class="listing-admin-tools"><button type="button" class="outline-btn listing-edit">ویرایش</button><button type="button" class="outline-btn listing-delete">حذف</button></div>`:'';
      article.innerHTML=`<div class="listing-cover ${['cover-pink','cover-blue','cover-purple'][i%3]}">${['🎯','🚗','⚽'][i%3]}</div><div class="listing-body"><span class="tag">${escapeHTML(x.game)}</span><h3>${escapeHTML(x.title)}</h3><p>${escapeHTML(x.description)}</p><div class="listing-foot"><b>معاوضه اکانت</b><button class="outline-btn listing-trade">درخواست معامله</button></div>${staffTools}</div>`;
      article.querySelector('.listing-trade').addEventListener('click',()=>navigate('trades'));
      if(isStaff){article.querySelector('.listing-edit').addEventListener('click',()=>createListing({admin:true,existing:x}));article.querySelector('.listing-delete').addEventListener('click',async()=>{if(!confirm(`آگهی «${x.title}» حذف شود؟`))return;const {error}=await supabase.from('listings').delete().eq('id',x.id);if(error){toast('حذف آگهی ناموفق بود: '+error.message);return;}toast('آگهی حذف شد.');await loadListings();await loadAdminListings();});}
      grid.appendChild(article);
    });
  }
  async function loadAdminListings(){
    const host=$('#adminListingsList'); if(!host||!isStaff||!supabase)return;
    const {data,error}=await supabase.from('listings').select('id,title,game,description,status').order('created_at',{ascending:false}).limit(50);
    if(error){host.textContent='بارگذاری آگهی‌ها ناموفق بود: '+error.message;return;}
    host.innerHTML='';
    if(!data?.length){host.innerHTML='<p class="muted">آگهی‌ای ثبت نشده است.</p>';return;}
    data.forEach(x=>{const row=document.createElement('div');row.className='role-row';row.innerHTML=`<span>${escapeHTML(x.title)} · ${escapeHTML(x.game)} <small>(${escapeHTML(x.status)})</small></span><span class="listing-admin-tools"><button class="tiny-btn edit-one">ویرایش</button><button class="tiny-btn delete-one">حذف</button></span>`;row.querySelector('.edit-one').addEventListener('click',()=>createListing({admin:true,existing:x}));row.querySelector('.delete-one').addEventListener('click',async()=>{if(!confirm(`آگهی «${x.title}» حذف شود؟`))return;const {error}=await supabase.from('listings').delete().eq('id',x.id);if(error){toast('حذف آگهی ناموفق بود: '+error.message);return;}toast('آگهی حذف شد.');await loadListings();await loadAdminListings();});host.appendChild(row);});
  }

  $('#joinTradeForm').addEventListener('submit', async e => {
    e.preventDefault();
    const code=$('#tradeCode').value.trim().toUpperCase();
    if (!session) { openAuth(); return; }
    if (!supabase) {
      $('#joinTradeResult').textContent='حالت نمایشی: برای ورود واقعی باید کد اتاق از دیتابیس بررسی شود.';
      return;
    }
    const {data,error}=await supabase.rpc('join_trade_room', {invite_code:code});
    if (error || !data) { $('#joinTradeResult').textContent='کد نامعتبر است یا اجازه ورود نداری.'; return; }
    activeTrade=data;
    $('#tradeRoomTitle').textContent=data.title;
    $('#tradeRoomSubtitle').textContent='اتاق معامله فعال · کد '+code;
    $('#tradeInput').disabled=false; $('#tradeForm button[type="submit"]').disabled=false; $('#tradeImageInput').disabled=false; $('#tradeVoiceBtn').disabled=false;
    $('#tradeMessages').innerHTML='<div class="welcome-card"><div class="welcome-emoji">🤝</div><h3>گفت‌وگو شروع شد</h3><p>لطفاً توافق‌ها را روشن ثبت کنید.</p></div>';
    loadTradeMessages();
    await loadTradeMembers();
    navigate('trades');
    $('#joinTradeResult').textContent='وارد اتاق شدی.';
  });
  async function loadTradeMembers() {
    const box = $('#tradeMembers');
    if (!box || !activeTrade || !supabase) return;
    const {data, error} = await supabase.from('trade_room_members').select('user_id, profiles(username)').eq('room_id', activeTrade.id);
    if (error) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<b>اعضای اتاق</b>' + (data || []).map(m => `<div class="trade-member"><span>${escapeHTML(m.profiles?.username || 'عضو')}</span>${isStaff && m.user_id !== session?.id ? `<button class="tiny-btn kick-member" data-user-id="${escapeHTML(m.user_id)}" type="button">اخراج</button>` : ''}</div>`).join('');
    box.querySelectorAll('.kick-member').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('این عضو از اتاق معامله خارج شود؟')) return;
      const {error} = await supabase.rpc('kick_trade_room_member', {target_room_id: activeTrade.id, target_user_id: btn.dataset.userId});
      if (error) { toast('اخراج عضو ناموفق بود: ' + error.message); return; }
      toast('عضو از اتاق خارج شد.'); await loadTradeMembers();
    }));
  }
  async function loadTradeMessages() {
    if (!supabase || !activeTrade) return;
    const box=$('#tradeMessages');
    const {data,error}=await supabase.from('trade_messages').select('id,user_id,username,content,image_url,created_at').eq('room_id',activeTrade.id).order('created_at',{ascending:true}).limit(100);
    if (error) { toast('پیام‌های اتاق بارگذاری نشدند.'); return; }
    box.innerHTML=''; data.forEach(m=>addMessage(box,{...m,time:fmtTime(new Date(m.created_at))},m.user_id===session?.id));
    if (tradeChannel) supabase.removeChannel(tradeChannel);
    tradeChannel=supabase.channel('trade-'+activeTrade.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'trade_messages',filter:'room_id=eq.'+activeTrade.id},payload=>{
      const m=payload.new; const node=messageNode({...m,time:fmtTime(new Date(m.created_at))},m.user_id===session?.id); node.dataset.id=m.id;
      const welcome=box.querySelector('.welcome-card'); if(welcome) welcome.remove(); box.appendChild(node); box.scrollTop=box.scrollHeight;
    }).subscribe();
  }
  $('#tradeForm').addEventListener('submit', async e=>{
    e.preventDefault(); const content=$('#tradeInput').value.trim(); const image_url=$('#tradeInput').dataset.imageUrl||null; if((!content&&!image_url)||!session||!activeTrade||!supabase)return;
    const username=currentUsername||session.user_metadata?.username||session.email.split('@')[0];
    const {error}=await supabase.from('trade_messages').insert({room_id:activeTrade.id,user_id:session.id,username,content:content||'📷 عکس',image_url});
    if(error) toast('ارسال پیام ناموفق بود: '+error.message); else {$('#tradeInput').value=''; delete $('#tradeInput').dataset.imageUrl; showImagePreview('tradeImagePreview','tradeImageInput',null);}
  });
  $('#refreshAdminRoomsBtn')?.addEventListener('click', loadAdminTradeRooms);
  async function loadAdminTradeRooms(){
    const box=$('#adminTradeRooms'); if(!box || !supabase || !isStaff) return;
    box.innerHTML='<p class="muted">در حال بارگذاری اتاق‌ها…</p>';
    const {data,error}=await supabase.from('trade_rooms').select('id,title,invite_code,status,created_at').order('created_at',{ascending:false}).limit(100);
    if(error){box.innerHTML='<p class="form-result">بارگذاری اتاق‌ها ناموفق بود: '+escapeHTML(error.message)+'</p>';return;}
    tradeRoomCache=data||[];
    if(!tradeRoomCache.length){box.innerHTML='<p class="muted">هنوز اتاق معامله‌ای ساخته نشده.</p>';return;}
    box.innerHTML=tradeRoomCache.map(r=>`<div class="admin-room-row"><div><b>${escapeHTML(r.title)}</b><small>کد: ${escapeHTML(r.invite_code)} · ${r.status==='active'?'فعال':'بسته'}</small></div><div class="admin-room-actions"><button type="button" class="tiny-btn admin-enter-room" data-room-id="${escapeHTML(r.id)}" ${r.status!=='active'?'disabled':''}>ورود و گفتگو</button><button type="button" class="tiny-btn admin-delete-room" data-room-id="${escapeHTML(r.id)}" ${r.status!=='active'?'disabled':''}>بستن اتاق</button></div></div>`).join('');
    box.querySelectorAll('.admin-enter-room').forEach(btn=>btn.addEventListener('click', async()=>{
      const room=tradeRoomCache.find(r=>r.id===btn.dataset.roomId); if(!room || !session)return;
      const {data,error}=await supabase.rpc('join_trade_room',{invite_code:room.invite_code});
      if(error || !data){toast('ورود به اتاق ناموفق بود: '+(error?.message||'خطای نامشخص'));return;}
      activeTrade=data;
      $('#tradeRoomTitle').textContent=data.title;
      $('#tradeRoomSubtitle').textContent='اتاق معامله فعال · کد '+data.invite_code;
      $('#tradeInput').disabled=false; $('#tradeForm button[type="submit"]').disabled=false; $('#tradeImageInput').disabled=false; $('#tradeVoiceBtn').disabled=false;
      $('#tradeInput').placeholder='پیام معامله...';
      await loadTradeMessages(); await loadTradeMembers(); navigate('trades');
      toast('وارد اتاق شدی؛ حالا می‌توانی پیام بدهی.');
    }));
    box.querySelectorAll('.admin-delete-room').forEach(btn=>btn.addEventListener('click',async()=>{
      const room=tradeRoomCache.find(r=>r.id===btn.dataset.roomId); if(!room)return;
      if(!confirm(`اتاق «${room.title}» بسته و از دسترس خارج شود؟`))return;
      const {error}=await supabase.rpc('close_trade_room',{room_id:room.id});
      if(error){toast('حذف اتاق ناموفق بود: '+error.message);return;}
      toast('اتاق معامله بسته و از دسترس خارج شد.'); await loadAdminTradeRooms();
    }));
  }

  $('#createTradeForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!session){openAuth();return;}
    if(!supabase){$('#createdTradeResult').textContent='حالت نمایشی: برای ساخت اتاق واقعی ابتدا Supabase و نقش مدیر را تنظیم کن.';return;}
    const title=$('#tradeTitle').value.trim(), buyer=$('#buyerName').value.trim(), seller=$('#sellerName').value.trim();
    const {data,error}=await supabase.rpc('create_trade_room',{room_title:title,buyer_username:buyer,seller_username:seller});
    if(error){console.error('GameLink create_trade_room error:', error); const detail = [error.message, error.details, error.hint, error.code].filter(Boolean).join(' | '); $('#createdTradeResult').textContent='ساخت اتاق ناموفق بود: ' + (detail || 'خطای نامشخص از Supabase') + ' — اگر نقش admin است، متن خطا را برای پشتیبانی ارسال کن.'; return;}
    $('#createdTradeResult').innerHTML=`کد اتاق ساخته شد: <b>${escapeHTML(data.invite_code)}</b> <button type="button" class="tiny-btn" id="copyCode">کپی</button>`;
    $('#copyCode').addEventListener('click',()=>navigator.clipboard.writeText(data.invite_code).then(()=>toast('کد کپی شد.')));
    $('#createTradeForm').reset();
    await loadAdminTradeRooms();
  });
  async function refreshOwnProfile(){ if(!supabase||!session)return; const {data}=await supabase.from('profiles').select('username').eq('id',session.id).maybeSingle(); if(data?.username){currentUsername=data.username;setUser(session); $('#newUsername').value=currentUsername;} }
  async function init() {
    if (supabase) {
      const {data}=await supabase.auth.getSession(); setUser(data.session?.user || null); if(data.session?.user) await refreshOwnProfile();
      supabase.auth.onAuthStateChange(async (_event,s) => { currentUsername=''; setUser(s?.user || null); if(s?.user){await refreshOwnProfile();loadPublicMessages();loadListings();refreshListingsState();loadInbox();} });
      await loadPublicMessages(); await loadListings(); await refreshListingsState();
    } else {
      setUser(null);
      $('#publicMessages').innerHTML='<div class="welcome-card"><div class="welcome-emoji">👋</div><h3>به جمعمون خوش اومدی!</h3><p>ظاهر سایت آماده است. برای چت زنده و ورود واقعی، Supabase را در config.js تنظیم کن و SQL همراه پروژه را اجرا کن.</p></div>';
    }
  }
  // Private messages (requires the matching SQL migration below).
let activeDM = null, dmChannel = null, lotteryIsActive = false, listingsAreActive = false;
async function openDM(username) {
  if (!session) { openAuth(); return; }
  if (!supabase) { toast('اتصال Supabase تنظیم نشده است.'); return; }
  const {data,error}=await supabase.rpc('open_direct_conversation',{target_username:username.trim()});
  if(error || !data) { toast('کاربر پیدا نشد یا امکان باز کردن پیوی وجود ندارد.'); return; }
  activeDM=data; activeDM.partnerUsername=username.trim(); $('#dmTitle').textContent='پیوی با '+username.trim(); $('#dmSubtitle').textContent='گفت‌وگوی خصوصی بین دو عضو';
  $('#dmInput').disabled=false; $('#dmImageInput').disabled=false; $('#dmForm button[type="submit"]').disabled=false;
  await loadDMMessages(); navigate('inbox');
}
async function openMediatorDM(){
  const result=$('#mediatorResult');
  if(!session){openAuth();return;}
  if(!supabase){result.textContent='اتصال Supabase تنظیم نشده است.';return;}
  const {data,error}=await supabase.rpc('open_owner_conversation');
  if(error||!data){result.textContent='پیام به واسطه باز نشد. مطمئن شو SQL جدید را در Supabase اجرا کرده‌ای.';return;}
  activeDM=data; activeDM.partnerUsername='واسطه GameLink';
  $('#dmTitle').textContent='پیوی با واسطه GameLink';
  $('#dmSubtitle').textContent='اینجا درخواست معامله‌ات را برای مدیر بفرست.';
  $('#dmInput').disabled=false; $('#dmImageInput').disabled=false; $('#dmForm button[type="submit"]').disabled=false;
  await loadDMMessages(); navigate('inbox');
}
$('#messageMediatorBtn')?.addEventListener('click',openMediatorDM);
$('#publicMessageMediatorBtn')?.addEventListener('click',openMediatorDM);
async function loadInbox(){
  const list=$('#inboxList'); if(!list)return;
  if(!session){list.innerHTML='<div class="welcome-card"><h3>برای دیدن پیام‌ها وارد شو</h3><button class="primary-btn" id="inboxLoginBtn">ورود / ثبت‌نام</button></div>';$('#inboxLoginBtn')?.addEventListener('click',openAuth);$('#inboxBadge').hidden=true;return;}
  if(!supabase){list.innerHTML='<div class="welcome-card"><p>اتصال Supabase تنظیم نشده است.</p></div>';return;}
  list.innerHTML='<div class="welcome-card"><p>در حال بارگذاری پیام‌ها…</p></div>';
  const {data:convos,error}=await supabase.from('direct_conversations').select('id,user_a,user_b,created_at').or(`user_a.eq.${session.id},user_b.eq.${session.id}`).order('created_at',{ascending:false}).limit(100);
  if(error){list.innerHTML='<div class="welcome-card"><p>بارگذاری پیام‌ها ناموفق بود. مطمئن شو SQL مربوط به پیوی‌ها اجرا شده.</p></div>';return;}
  if(!convos?.length){list.innerHTML='<div class="welcome-card"><div class="welcome-emoji">💌</div><h3>هنوز پیامی نداری</h3><p>وقتی به کسی پیام بدی یا کسی بهت پیام بده، گفتگو اینجا میاد.</p></div>';$('#inboxBadge').hidden=true;return;}
  const partnerIds=[...new Set(convos.map(c=>c.user_a===session.id?c.user_b:c.user_a))];
  const {data:profiles}=await supabase.from('profiles').select('id,username').in('id',partnerIds);
  const names=new Map((profiles||[]).map(p=>[p.id,p.username]));
  const rows=[]; let unread=0;
  for(const c of convos){
    const {data:msgs}=await supabase.from('direct_messages').select('id,sender_id,username,content,image_url,created_at').eq('conversation_id',c.id).order('created_at',{ascending:false}).limit(1);
    const last=msgs?.[0]||null; const partnerId=c.user_a===session.id?c.user_b:c.user_a;
    const partner=names.get(partnerId)||'عضو'; const incoming=!!last&&last.sender_id!==session.id;
    if(incoming)unread++;
    rows.push({c,partner,last,incoming});
  }
  list.innerHTML='';
  rows.sort((a,b)=>new Date(b.last?.created_at||b.c.created_at)-new Date(a.last?.created_at||a.c.created_at));
  for(const r of rows){
    const card=document.createElement('button');card.type='button';card.className='inbox-item'+(r.incoming?' inbox-new':'');
    const preview=r.last?(r.last.image_url&&!r.last.content?'📷 عکس':r.last.content||'📷 عکس'):'هنوز پیامی ارسال نشده';
    card.innerHTML=`<span class="inbox-avatar">${escapeHTML((r.partner||'ع').slice(0,1).toUpperCase())}</span><span class="inbox-copy"><b>${escapeHTML(r.partner)}</b><small>${escapeHTML(preview)}</small></span><span class="inbox-state">${r.incoming?'<i></i> پیام دریافتی':'باز کردن'}</span>`;
    card.addEventListener('click',async()=>{activeDM={id:r.c.id,partnerUsername:r.partner};$('#dmTitle').textContent='پیوی با '+r.partner;$('#dmSubtitle').textContent='گفت‌وگوی خصوصی بین دو عضو';$('#dmInput').disabled=false;$('#dmImageInput').disabled=false;$('#dmForm button[type="submit"]').disabled=false;await loadDMMessages();});
    list.appendChild(card);
  }
  const badge=$('#inboxBadge');badge.textContent=String(unread);badge.hidden=unread===0;
}
async function loadDMMessages(){
  if(!supabase||!activeDM)return; const box=$('#dmMessages');
  const {data,error}=await supabase.from('direct_messages').select('id,conversation_id,sender_id,username,content,image_url,created_at').eq('conversation_id',activeDM.id).order('created_at',{ascending:true}).limit(100);
  if(error){toast('بارگذاری پیوی ناموفق بود: '+error.message);return;}
  box.innerHTML=''; if(!data.length) box.innerHTML='<div class="welcome-card"><h3>اولین پیام رو بفرست!</h3></div>';
  data.forEach(m=>{const n=messageNode({...m,table:'direct_messages',time:fmtTime(new Date(m.created_at))},m.sender_id===session.id);n.dataset.id=m.id;n.dataset.table='direct_messages';box.appendChild(n);}); box.scrollTop=box.scrollHeight;
  if(dmChannel) supabase.removeChannel(dmChannel);
  dmChannel=supabase.channel('dm-'+activeDM.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'direct_messages',filter:'conversation_id=eq.'+activeDM.id},payload=>{
    const m=payload.new;if(box.querySelector(`[data-id="${m.id}"]`))return;const n=messageNode({...m,table:'direct_messages',time:fmtTime(new Date(m.created_at))},m.sender_id===session?.id);n.dataset.id=m.id;n.dataset.table='direct_messages';const w=box.querySelector('.welcome-card');if(w)w.remove();box.appendChild(n);box.scrollTop=box.scrollHeight;loadInbox();
  }).subscribe();
}
$('#dmForm')?.addEventListener('submit',async e=>{e.preventDefault();const content=$('#dmInput').value.trim();const image_url=$('#dmInput').dataset.imageUrl||null;if((!content&&!image_url)||!session||!activeDM||!supabase)return;const username=session.user_metadata?.username||session.email.split('@')[0];const {error}=await supabase.from('direct_messages').insert({conversation_id:activeDM.id,sender_id:session.id,username,content,image_url});if(error)toast('پیام خصوصی ارسال نشد: '+error.message);else{$('#dmInput').value='';delete $('#dmInput').dataset.imageUrl;showImagePreview('dmImagePreview','dmImageInput',null);loadInbox();}});


  // Edit/delete only messages belonging to the signed-in user.
  document.addEventListener('click', async e => {
    const adminDel=e.target.closest('.admin-delete-public-message');
    if(adminDel){
      if(!isPrimaryAdmin || !supabase) return;
      const row=adminDel.closest('.message-row'), id=row?.dataset.id;
      if(!id || !confirm('این پیام از چت عمومی برای همه حذف شود؟')) return;
      const {error}=await supabase.rpc('admin_delete_public_message',{target_message_id:id});
      if(error){toast('حذف پیام ناموفق بود: '+error.message);return;}
      row.remove(); toast('پیام از چت عمومی حذف شد.'); return;
    }
    const del=e.target.closest('.message-delete'), edit=e.target.closest('.message-edit');
    if(!del&&!edit)return;
    const row=e.target.closest('.message-row'), id=row?.dataset.id, table=row?.dataset.table;
    if(!session||!supabase||!id||!['public_messages','direct_messages'].includes(table)){toast('این پیام قابل تغییر نیست.');return;}
    const ownerColumn=table==='public_messages'?'user_id':'sender_id';
    if(del){if(!confirm('این پیام حذف شود؟'))return;const {error}=await supabase.from(table).delete().eq('id',id).eq(ownerColumn,session.id);if(error)toast('حذف ناموفق بود: '+error.message);else{row.remove();toast('پیام حذف شد.');}return;}
    const old=row.querySelector('.bubble')?.textContent||'';
    if(!old || old.startsWith('[[VOICE]]')){toast('ویرایش فقط برای پیام متنی است.');return;}
    const updated=prompt('متن جدید پیام:',old);if(updated===null||!updated.trim())return;
    const {error}=await supabase.from(table).update({content:updated.trim()}).eq('id',id).eq(ownerColumn,session.id);
    if(error)toast('ویرایش ناموفق بود: '+error.message);else{toast('پیام ویرایش شد.');if(table==='public_messages')loadPublicMessages();else loadDMMessages();}
  });
  async function recordVoice(inputSelector, table) {
    if(!session||!supabase){openAuth();return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('ضبط صدا در این مرورگر پشتیبانی نمی‌شود.');return;}
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const rec=new MediaRecorder(stream), chunks=[];
      rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      rec.onstop=async()=>{
        stream.getTracks().forEach(t=>t.stop());
        const blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'});
        if(blob.size>10*1024*1024){toast('فایل صدا بیشتر از ۱۰ مگابایت است.');return;}
        const path=`${session.id}/${Date.now()}-voice.webm`;
        const {error:upErr}=await supabase.storage.from('chat-images').upload(path,blob,{upsert:false,contentType:blob.type||'audio/webm'});
        if(upErr){toast('آپلود صدا ناموفق بود؛ SQL به‌روزرسانی‌شده را اجرا کن.');return;}
        const {data}=supabase.storage.from('chat-images').getPublicUrl(path);
        const username=session.user_metadata?.username||session.email.split('@')[0];
        let result;
        if(table==='public_messages') result=await supabase.from(table).insert({user_id:session.id,username,content:'[[VOICE]]'+data.publicUrl});
        else if(table==='trade_messages') {if(!activeTrade){toast('اول وارد اتاق معامله شو.');return;} result=await supabase.from(table).insert({room_id:activeTrade.id,user_id:session.id,username,content:'[[VOICE]]'+data.publicUrl});}
        else {if(!activeDM){toast('اول یک گفت‌وگوی خصوصی باز کن.');return;} result=await supabase.from(table).insert({conversation_id:activeDM.id,sender_id:session.id,username,content:'[[VOICE]]'+data.publicUrl});}
        if(result.error)toast('ارسال صدا ناموفق بود: '+result.error.message);else{toast('پیام صوتی ارسال شد.');if(table==='public_messages')loadPublicMessages();else if(table==='trade_messages')loadTradeMessages();else loadDMMessages();}
      };
      if(!confirm('برای شروع ضبط صدا تأیید کن؛ برای پایان ضبط دوباره دکمه را بزن.')){stream.getTracks().forEach(t=>t.stop());return;}
      const btn=$(inputSelector);btn.textContent='⏹ پایان ضبط';btn.dataset.recording='1';
      btn.onclick=()=>{if(rec.state!=='inactive')rec.stop();btn.textContent='🎙 صدا';btn.dataset.recording='';btn.onclick=()=>recordVoice(inputSelector,table);};
      rec.start();toast('در حال ضبط… برای پایان دوباره دکمه صدا را بزن.');
    } catch(err){toast('دسترسی به میکروفون داده نشد.');}
  }
  $('#publicVoiceBtn')?.addEventListener('click',()=>recordVoice('#publicVoiceBtn','public_messages'));
  $('#dmVoiceBtn')?.addEventListener('click',()=>recordVoice('#dmVoiceBtn','direct_messages'));
  $('#tradeVoiceBtn')?.addEventListener('click',()=>recordVoice('#tradeVoiceBtn','trade_messages'));
  $('#tradeImageInput')?.addEventListener('change',async e=>{const file=e.target.files?.[0];if(file)showImagePreview('tradeImagePreview','tradeImageInput',file);const url=await uploadChatImage(e.target);if(url){$('#tradeInput').dataset.imageUrl=url;toast('عکس آماده ارسال است؛ دکمه ارسال را بزن.')}else if(!e.target.files?.length)showImagePreview('tradeImagePreview','tradeImageInput',null);});

  async function refreshLottery(){if(!supabase)return;const {data,error}=await supabase.from('lottery_state').select('is_active,winner_username,drawn_at').eq('id',1).maybeSingle();const status=$('#lotteryStatus'),winner=$('#lotteryWinner');if(error){if(status)status.textContent='برای فعال‌سازی این بخش، SQL قرعه‌کشی را اجرا کن.';return;}lotteryIsActive=!!data?.is_active; if(status)status.textContent=data?.is_active?'قرعه‌کشی فعال است!':'قرعه‌کشی هنوز فعال نشده'; if($('#lotteryNav'))$('#lotteryNav').hidden=!(isStaff||lotteryIsActive);if(winner){winner.hidden=!data?.winner_username;winner.textContent=data?.winner_username?`🏆 نام برنده: ${data.winner_username}`:'';}const a=$('#lotteryAdminStatus');if(a)a.textContent=data?.is_active?'وضعیت: فعال':'وضعیت: غیرفعال';if($('#toggleLotteryBtn'))$('#toggleLotteryBtn').hidden=!isStaff;if($('#drawLotteryBtn'))$('#drawLotteryBtn').hidden=!isStaff;}
  $('#toggleLotteryBtn')?.addEventListener('click',async()=>{if(!isStaff||!supabase)return;const {data}=await supabase.from('lottery_state').select('is_active').eq('id',1).maybeSingle();const {error}=await supabase.from('lottery_state').upsert({id:1,is_active:!data?.is_active},{onConflict:'id'});if(error){toast('تغییر وضعیت قرعه‌کشی ناموفق بود: '+error.message);return;}await refreshLottery();});
  $('#drawLotteryBtn')?.addEventListener('click',async()=>{if(!isStaff||!supabase)return;const {data,error}=await supabase.rpc('draw_account_lottery');if(error){toast('قرعه‌کشی انجام نشد: '+error.message);return;}toast('قرعه‌کشی انجام شد.');await refreshLottery();});
  init();
})();
