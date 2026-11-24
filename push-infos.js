(function () {
  'use strict';
  let messaging, busy=false, pendingRequest=null;
  const config=window.AAPPMA_PUSH||{};
  const status=(id,text)=>{const el=document.getElementById(id);if(el)el.textContent=text;};
  async function api(data) {
    if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(config.scriptUrl||'')) throw new Error('Les notifications ne sont pas encore configurées par l’administrateur.');
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),180000);
    try {
      const r=await fetch(config.scriptUrl,{method:'POST',credentials:'omit',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(data),signal:abort.signal});
      if(!r.ok)throw new Error('Service indisponible (HTTP '+r.status+').');
      const v=await r.json();if(!v.ok)throw new Error(v.error||'Échec du service.');return v;
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
    const btn=document.getElementById('pushEnable');btn.disabled=true;
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
    } catch(e){status('pushStatus',e.message);}finally{busy=false;btn.disabled=false;}
  };
  window.desactiverNotificationsInfos=async function(){
    if(busy)return;busy=true;
    try{
      const saved=JSON.parse(localStorage.getItem('aappmaPushDevice')||'null');
      if(saved)await api({action:'unregister',device:saved.device,deviceSecret:saved.deviceSecret});
      if(!messaging&&await firebase.messaging.isSupported())messaging=firebase.messaging(appCentral);
      if(messaging)await messaging.deleteToken();
      localStorage.removeItem('aappmaPushDevice');status('pushStatus','Notifications désactivées sur cet appareil.');
    }catch(e){status('pushStatus',e.message);}finally{busy=false;}
  };
  function recipientsPush(){return [...document.querySelectorAll('[data-push-recipient]:checked')].map(el=>el.value).sort();}
  function syncAllPush(){
    const boxes=[...document.querySelectorAll('[data-push-recipient]')],all=document.getElementById('pushSelectAll');
    all.disabled=!boxes.length;all.checked=!!boxes.length&&boxes.every(el=>el.checked);
    all.indeterminate=boxes.some(el=>el.checked)&&!all.checked;
  }
  window.selectionnerTousPush=function(checked){document.querySelectorAll('[data-push-recipient]').forEach(el=>el.checked=checked);syncAllPush();};
  window.chargerDestinatairesPush=async function(){
    if(busy)return;
    try{
      const user=connected();if(!isAdminUserName(user))throw new Error('Accès réservé à l’administrateur.');
      busy=true;
      const previous=new Set(recipientsPush()),container=document.getElementById('pushRecipients');
      container.textContent='Chargement…';syncAllPush();
      const [names,access]=await Promise.all([dbCentral.ref('controleurs').once('value'),dbCentral.ref('controleurs_access').once('value')]);
      const rights=access.val()||{};
      const users=[...new Set(Object.values(names.val()||{}).filter(n=>typeof n==='string'&&rights[n]!==false&&!(rights[n]&&rights[n].revoked===true)))].sort((a,b)=>a.localeCompare(b,'fr'));
      container.textContent='';
      users.forEach(name=>{
        const label=document.createElement('label'),box=document.createElement('input');
        box.type='checkbox';box.value=name;box.dataset.pushRecipient='';box.checked=previous.has(name);box.addEventListener('change',syncAllPush);
        label.append(box,document.createTextNode(' '+name));container.append(label);
      });
      if(!users.length)container.textContent='Aucun contrôleur autorisé.';
      syncAllPush();
    }catch(e){status('pushAdminStatus',e.message);}finally{busy=false;}
  };
  window.transmettreNotificationInfos=async function(testOnly){
    if(busy)return;
    try {
      const user=connected();if(!isAdminUserName(user))throw new Error('Accès réservé à l’administrateur.');
      if(!config.scriptUrl)throw new Error('Configurez d’abord le service de notifications.');
      if(!testOnly&&!infoSections.length)throw new Error('Publiez une information avant de transmettre.');
      const recipients=testOnly?[user]:recipientsPush();
      if(!recipients.length)throw new Error('Cochez au moins un destinataire ou la case Tout le monde.');
      if(!confirm(testOnly?'Envoyer une notification de test à vos appareils activés ?':'Prévenir les '+recipients.length+' contrôleur(s) sélectionné(s) : '+recipients.join(', ')+' ? Enregistrez vos informations avant cet envoi.'))return;
      const secret=prompt('Code de transmission des notifications (PUSH_ADMIN_SECRET) :');if(!secret)return;
      busy=true;document.querySelectorAll('[data-push-send]').forEach(b=>b.disabled=true);
      status('pushAdminStatus','Transmission en cours…');
      // Réutiliser l’identifiant après une réponse perdue, afin de ne pas doubler l’envoi.
      const mode=JSON.stringify({testOnly:!!testOnly,recipients});
      if(!pendingRequest||pendingRequest.mode!==mode)pendingRequest={mode,id:crypto.randomUUID()};
      const r=await api({action:'broadcastSelected',secret,user,testOnly:!!testOnly,recipients,requestId:pendingRequest.id});
      pendingRequest=null;
      status('pushAdminStatus',r.accepted+' notification(s) acceptée(s) par le service pour '+r.users+' contrôleur(s), '+r.failed+' échec(s) ou résultat(s) incertain(s). La réception sur chaque téléphone reste à vérifier.');
    }catch(e){status('pushAdminStatus',e.message);}finally{busy=false;document.querySelectorAll('[data-push-send]').forEach(b=>b.disabled=false);}
  };
  // Initialiser l’écoute au premier plan sans demander d’autorisation.
  if('Notification' in window&&Notification.permission==='granted')initMessaging().catch(()=>{});
  try {const s=JSON.parse(localStorage.getItem('aappmaPushDevice')||'null');if(s)status('pushStatus','Appareil enregistré pour '+s.user+'. Réactivez ici si vous changez de compte ou de navigateur.');}catch(ignore){}
})();
