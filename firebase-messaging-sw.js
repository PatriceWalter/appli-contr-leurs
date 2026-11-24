// Pas de cache des pages : les mises à jour du site restent immédiatement accessibles.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// Ce gestionnaire précède Firebase pour les notifications créées au premier plan.
self.addEventListener('notificationclick',event=>{
  event.stopImmediatePropagation();event.notification.close();
  const target=new URL('./?push=info',self.location.href).href;
  event.waitUntil((async()=>{
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const page=clients.find(c=>new URL(c.url).pathname.startsWith('/appli-contr-leurs/'));
    if(page){await page.navigate(target);return page.focus();}
    return self.clients.openWindow(target);
  })());
});
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');
firebase.initializeApp({apiKey:'AIzaSyCJk0Tfn4IU4DUEKCRVZmI-90s4cAnbyGA',authDomain:'appli-controleur-gunder.firebaseapp.com',projectId:'appli-controleur-gunder',messagingSenderId:'780831512988',appId:'1:780831512988:web:f0f263cfaf9abd18269059'});
firebase.messaging();
// Les messages notification sont affichés automatiquement par Firebase en arrière-plan.
