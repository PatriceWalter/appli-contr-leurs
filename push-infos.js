(function () {
  'use strict';
  let messaging, busy=false, pendingRequest=null;
  const config=window.AAPPMA_PUSH||{};
  const status=(id,text)=>{const el=document.getElementById(id);if(el)el.textContent=text;};
  function savedPushDevice(){try{return JSON.parse(localStorage.getItem('aappmaPushDevice')||'null');}catch(ignore){return null;}}
  function notificationsActive(){
    const saved=savedPushDevice();
    return !!(saved&&saved.user===getCurrentUser()&&saved.device&&saved.deviceSecret&&'Notification' in window&&Notification.permission==='granted');
  }
  function refreshPushSwitch(){
    const button=document.getElementById('pushEnable');if(!button)return;
    const active=notificationsActive();button.setAttribute('aria-checked',String(active));button.disabled=busy;
    status('pushSwitchLabel',busy?'En cours…':active?'Activées':'Désactivées');
    document.getElementById('pushBellDot')?.classList.toggle('is-on',active);
  }
  window.basculerNotificationsInfos=function(){
    if(busy)return;
    if(notificationsActive())return window.desactiverNotificationsInfos();
    return window.activerNotificationsInfos();
  };
  async function api(data) {
    if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(config.scriptUrl||'')) throw new Error('Les notifications ne sont pas encore configurées par l’administrateur.');
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),180000);
    try {
      const r=await fetch(config.scriptUrl,{method:'POST',credentials:'omit',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(data),signal:abort.signal});
      if(!r.ok)throw new Error('Service indisponible (HTTP '+r.status+').');
      const v=await r.json();if(!v.ok)throw new Error(v.error==='Action inconnue.'?'Le déploiement Google utilise encore une ancienne version. Mettez à jour le déploiement existant avec le dernier Code.gs.':v.error||'Échec du service.');return v;
    } catch(e) {
      if(e.name==='AbortError'||e instanceof TypeError)throw new Error('Réponse non reçue. L’envoi a peut-être été effectué : vérifiez avant de recommencer.');
      throw e;
    } finally {clearTimeout(timer);}
  }
  function connected() {
    if(sessionStorage.getItem('logged')!=='true'||!getCurrentUser())throw new Error('Connectez-vous à votre compte contrôleur.');
    return getCurrentUser();
  }
  async function initMessaging() {
    if(!window.isSecureContext||!('serviceWorker' in navigator)||!('Notification' in window))throw new Error('Notifications indisponibles dans ce navigateur. Utilisez un navigateur compatible en HTTPS.');
    const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    if(ios&&!navigator.standalone&&!matchMedia('(display-mode: standalone)').matches)throw new Error('Sur iPhone : Partager → Sur l’écran d’accueil, puis ouvrez le site depuis cette icône. iOS 16.4 minimum.');
    if(!await firebase.messaging.isSupported())throw new Error('Ce navigateur ne prend pas en charge les notifications push.');
    if(!messaging){
      messaging=firebase.messaging(appCentral);
      messaging.onMessage(payload=>{
        if(sessionStorage.getItem('logged')!=='true')return;
        const n=payload.notification||{};
        // Une seule notification, même quand le site est au premier plan.
        navigator.serviceWorker.getRegistration('./').then(reg=>{
          if(reg)reg.showNotification(n.title||'AAPPMA Gundershoffen',{body:n.body||'Une nouvelle information est disponible.',tag:'aappma-info',data:{url:new URL('?push=info',location.href).href}});
        }).catch(()=>showAlert('ℹ️ Une nouvelle information est disponible dans Infos.', 'success'));
      });
    }
    return navigator.serviceWorker.register('./firebase-messaging-sw.js',{scope:'./'});
  }
  async function readyWorker(reg){
    if(reg.active)return reg;
    const worker=reg.installing||reg.waiting;
    if(!worker)throw new Error('Installation des notifications incomplète. Rechargez la page.');
    await new Promise((resolve,reject)=>{
      const t=setTimeout(()=>reject(new Error('Installation trop longue. Rechargez la page.')),20000);
      const change=()=>{if(worker.state==='activated'){clearTimeout(t);worker.removeEventListener('statechange',change);resolve();}else if(worker.state==='redundant'){clearTimeout(t);reject(new Error('Installation du service de notifications impossible.'));}};
      worker.addEventListener('statechange',change);change();
    });return reg;
  }
  window.activerNotificationsInfos=async function(){
    if(busy)return;busy=true;
    refreshPushSwitch();
    try {
      const user=connected();
      if(!config.scriptUrl)throw new Error('Les notifications ne sont pas encore configurées par l’administrateur.');
      // Appel direct depuis le clic pour respecter les règles Safari.
      const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
      if(ios&&!navigator.standalone&&!matchMedia('(display-mode: standalone)').matches)throw new Error('Sur iPhone, ajoutez le site à l’écran d’accueil puis ouvrez cette icône.');
      if(!('Notification' in window))throw new Error('Notifications non prises en charge dans ce navigateur.');
      const permission=Notification.permission==='default'?await Notification.requestPermission():Notification.permission;
      if(permission!=='granted')throw new Error('Notifications non autorisées. Vous pouvez modifier ce choix dans les réglages du navigateur.');
      const password=prompt('Pour associer ce téléphone à '+user+', saisissez votre mot de passe contrôleur :');
      if(password===null)return;
      status('pushStatus','Activation en cours…');
      const reg=await readyWorker(await initMessaging());
      const token=await messaging.getToken({vapidKey:config.vapidKey,serviceWorkerRegistration:reg});
      if(!token)throw new Error('Aucun identifiant de notification reçu.');
      const r=await api({action:'register',user,password,token});
      localStorage.setItem('aappmaPushDevice',JSON.stringify({user,device:r.device,deviceSecret:r.deviceSecret}));
      status('pushStatus','Notifications activées sur cet appareil pour '+user+'.');
    } catch(e){status('pushStatus',e.message);}finally{busy=false;refreshPushSwitch();}
  };
  window.desactiverNotificationsInfos=async function(){
    if(busy)return;busy=true;refreshPushSwitch();
    try{
      const saved=JSON.parse(localStorage.getItem('aappmaPushDevice')||'null');
      if(saved)await api({action:'unregister',device:saved.device,deviceSecret:saved.deviceSecret});
      localStorage.removeItem('aappmaPushDevice');
      if(!messaging&&await firebase.messaging.isSupported())messaging=firebase.messaging(appCentral);
      if(messaging)await messaging.deleteToken();
      status('pushStatus','Notifications désactivées sur cet appareil.');
    }catch(e){status('pushStatus',e.message);}finally{busy=false;refreshPushSwitch();}
  };
  window.creerEnvoiAnnoncePush=function(section){
    if(sessionStorage.getItem('logged')!=='true'||!isAdminUserName(getCurrentUser()))return null;
    installForgetPush();
    const root=document.createElement('div');root.className='push-announcement';
    const controls=document.createElement('div');controls.className='push-announcement-controls';
    const menu=document.createElement('details');menu.className='push-recipient-menu';
    const summary=document.createElement('summary');summary.textContent='Destinataires ▾';
    const list=document.createElement('div');list.className='push-recipient-list';
    const send=document.createElement('button');send.type='button';send.className='btn btn-primary';send.textContent='🔔 Envoyer';send.dataset.pushSend='';
    const result=document.createElement('p');result.className='push-announcement-status';result.setAttribute('role','status');
    const state={section,result,boxes:[],all:null,loaded:false,loading:false};
    function selected(){return state.boxes.filter(b=>b.checked).map(b=>b.value).sort();}
    function sync(){
      const n=selected().length;
      state.all.checked=!!n&&n===state.boxes.length;state.all.indeterminate=!!n&&!state.all.checked;
      summary.textContent=state.all.checked?'Tout le monde ('+n+') ▾':n?n+' destinataire(s) ▾':'Destinataires ▾';
    }
    menu.addEventListener('toggle',async()=>{
      if(!menu.open||state.loaded||state.loading)return;
      state.loading=true;list.textContent='Chargement…';
      try{
        const user=connected();if(!isAdminUserName(user))throw new Error('Accès réservé à l’administrateur.');
        const [names,access]=await Promise.all([dbCentral.ref('controleurs').once('value'),dbCentral.ref('controleurs_access').once('value')]);
        const rights=access.val()||{};
        const namesList=[...new Set(Object.values(names.val()||{}).filter(n=>typeof n==='string'&&rights[n]!==false&&!(rights[n]&&rights[n].revoked===true)))].sort((a,b)=>a.localeCompare(b,'fr'));
        list.textContent='';
        function checkbox(text){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';label.append(box,document.createTextNode(text));list.append(label);return box;}
        state.all=checkbox('Tout le monde');state.all.disabled=!namesList.length;
        state.all.addEventListener('change',()=>{state.boxes.forEach(b=>b.checked=state.all.checked);sync();});
        namesList.forEach(name=>{const box=checkbox(name);box.value=name;box.addEventListener('change',sync);state.boxes.push(box);});
        if(!namesList.length)result.textContent='Aucun contrôleur autorisé.';
        state.loaded=true;
      }catch(e){list.textContent=e.message+' Fermez puis rouvrez ce menu pour réessayer.';}finally{state.loading=false;}
    });
    send.addEventListener('click',()=>window.transmettreNotificationInfos(false,{...state,recipients:selected(),everyone:!!state.all?.checked}));
    menu.append(summary,list);controls.append(menu,send);root.append(controls,result);
    return root;
  };
  const adminKeyPrefix='aappmaPushAdmin:'+config.scriptUrl+':';
  const adminKeysInMemory=new Map();
  function adminKeyName(user){return adminKeyPrefix+user;}
  function readAdminKey(user){
    if(adminKeysInMemory.has(user))return adminKeysInMemory.get(user);
    try{return localStorage.getItem(adminKeyName(user))||'';}catch(ignore){return '';}
  }
  function rememberAdminKey(user,secret){
    adminKeysInMemory.set(user,secret);
    try{localStorage.setItem(adminKeyName(user),secret);return true;}catch(ignore){return false;}
  }
  function forgetAdminKey(user){
    adminKeysInMemory.delete(user);
    try{localStorage.removeItem(adminKeyName(user));}catch(ignore){}
  }
  window.oublierAutorisationPush=function(){
    if(busy)return;
    try{
      const user=connected();if(!isAdminUserName(user))throw new Error('Accès réservé à l’administrateur.');
      forgetAdminKey(user);status('pushStatus','Autorisation d’envoi effacée de cet appareil. La clé sera demandée au prochain envoi.');
    }catch(e){status('pushStatus',e.message);}
  };
  function installForgetPush(){
  const pushSettingsPanel=document.querySelector('.push-settings-panel');
  if(pushSettingsPanel&&isAdminUserName(getCurrentUser())&&!document.getElementById('pushForgetAdmin')){
    const forget=document.createElement('button');forget.type='button';forget.className='btn';
    forget.id='pushForgetAdmin';forget.textContent='Oublier l’autorisation d’envoi';
    forget.addEventListener('click',window.oublierAutorisationPush);pushSettingsPanel.append(forget);
  }
  }
  window.transmettreNotificationInfos=async function(testOnly,announcement){
    if(busy)return;
    const report=text=>{
      if(announcement?.result)announcement.result.textContent=text;
      let banner=document.getElementById('pushSendFeedback');
      if(!banner){
        const host=document.querySelector('#pageInfo .page-content');
        if(host){banner=document.createElement('p');banner.id='pushSendFeedback';banner.setAttribute('role','status');banner.style.cssText='padding:12px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;color:#253347;line-height:1.5;';host.prepend(banner);}
      }
      if(banner)banner.textContent=text;else status('pushStatus',text);
    };
    try {
      const user=connected();if(!isAdminUserName(user))throw new Error('Accès réservé à l’administrateur.');
      if(!config.scriptUrl)throw new Error('Configurez d’abord le service de notifications.');
      if(!testOnly&&!infoSections.length)throw new Error('Publiez une information avant de transmettre.');
      if(!testOnly&&(!announcement||!infoSections.some(s=>s.id===announcement.section.id)))throw new Error('Cette annonce n’est plus disponible. Rechargez les informations.');
      const recipients=testOnly?[user]:announcement.recipients;
      if(!recipients.length)throw new Error('Cochez au moins un destinataire ou la case Tout le monde.');
      const destination=announcement?.everyone?'tout le monde ('+recipients.length+' contrôleurs)':'ces '+recipients.length+' destinataire(s)';
      if(!confirm(testOnly?'Envoyer une notification de test à vos appareils activés ?':'Envoyer la notification concernant « '+(announcement.section.title||'Information')+' » à '+destination+' ?\n\n'+recipients.join(', ')+'\n\nSeuls les appareils ayant activé les notifications la recevront.'))return;
      let secret=readAdminKey(user);
      if(!secret){
        const entered=prompt('Configuration unique sur votre appareil personnel : collez votre clé PUSH_ADMIN_SECRET. Après validation, elle sera conservée ici pour vos prochains envois. Toute personne ayant accès à votre session pourra envoyer des notifications.');
        if(!entered||!entered.trim())return;
        secret=entered.trim();
        rememberAdminKey(user,secret);
      }
      busy=true;document.querySelectorAll('[data-push-send]').forEach(b=>b.disabled=true);
      report('Transmission en cours…');
      // Réutiliser l’identifiant après une réponse perdue, afin de ne pas doubler l’envoi.
      const mode=JSON.stringify({testOnly:!!testOnly,recipients,section:announcement?.section.id});
      if(!pendingRequest||pendingRequest.mode!==mode)pendingRequest={mode,id:crypto.randomUUID()};
      let r;
      try{
        r=await api({action:'broadcastSelected',secret,user,testOnly:!!testOnly,recipients,requestId:pendingRequest.id});
      }catch(e){
        if(e.message==='Code de transmission incorrect.')forgetAdminKey(user);
        throw e;
      }
      const persisted=rememberAdminKey(user,secret);
      pendingRequest=null;
      report(r.accepted+' notification(s) acceptée(s) par le service pour '+r.users+' contrôleur(s), '+r.failed+' échec(s) ou résultat(s) incertain(s). La réception sur chaque téléphone reste à vérifier.'+(persisted?'':' Le navigateur bloque la mémorisation : la clé reste disponible uniquement tant que cette page est ouverte.'));
    }catch(e){report(e.message);if(typeof showAlert==='function')showAlert(e.message,'error');else alert(e.message);}finally{busy=false;document.querySelectorAll('[data-push-send]').forEach(b=>b.disabled=false);}
  };
  // Initialiser l’écoute au premier plan sans demander d’autorisation.
  if('Notification' in window&&Notification.permission==='granted')initMessaging().catch(()=>{});
  const settings=document.getElementById('pushSettings'),infoPage=document.getElementById('pageInfo');
  let infoWasVisible=false;
  function refreshInfoSettings(){
    refreshPushSwitch();
    const visible=!!infoPage?.classList.contains('active');
    if(visible&&!infoWasVisible&&settings){
      const user=getCurrentUser();
      if(user){
        const seenKey='aappmaPushSettingsSeen:'+user;
        let seen=false;try{seen=localStorage.getItem(seenKey)==='true';}catch(ignore){}
        settings.open=!seen&&!notificationsActive();
        try{localStorage.setItem(seenKey,'true');}catch(ignore){}
        status('pushStatus',notificationsActive()?'Vous recevez les notifications sur cet appareil.':'Activez les notifications pour être prévenu des nouvelles informations.');
      }
    }
    if(!visible&&settings)settings.open=false;
    infoWasVisible=visible;
  }
  if(infoPage)new MutationObserver(refreshInfoSettings).observe(infoPage,{attributes:true,attributeFilter:['class']});
  window.addEventListener('focus',refreshPushSwitch);
  window.addEventListener('storage',refreshPushSwitch);
  document.addEventListener('click',event=>{if(settings?.open&&!settings.contains(event.target))settings.open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&settings?.open){settings.open=false;settings.querySelector('summary').focus();}});
  refreshInfoSettings();
  if(typeof renderInfoSections==='function')renderInfoSections();
})();
