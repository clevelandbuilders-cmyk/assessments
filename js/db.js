const DB = (() => {
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

  /* ═══════════════════════════════════════════════════════════════════════
     LOCAL BACKEND  (Demo Mode — IndexedDB + localStorage)
  ═══════════════════════════════════════════════════════════════════════ */
  function buildLocalDB() {
    let _idb = null;

    function openIDB() {
      if (_idb) return Promise.resolve(_idb);
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('jobcam_demo', 1);
        req.onupgradeneeded = e => {
          const d = e.target.result;
          if (!d.objectStoreNames.contains('photos')) {
            d.createObjectStore('photos', { keyPath: 'id' })
             .createIndex('jobId', 'jobId');
          }
        };
        req.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
        req.onerror   = () => reject(req.error);
      });
    }

    function idbGet(id) {
      return openIDB().then(db => new Promise((res, rej) => {
        const r = db.transaction('photos', 'readonly').objectStore('photos').get(id);
        r.onsuccess = () => res(r.result);
        r.onerror   = () => rej(r.error);
      }));
    }

    function idbPut(obj) {
      return openIDB().then(db => new Promise((res, rej) => {
        const r = db.transaction('photos', 'readwrite').objectStore('photos').put(obj);
        r.onsuccess = () => res();
        r.onerror   = () => rej(r.error);
      }));
    }

    function idbDelete(id) {
      return openIDB().then(db => new Promise((res, rej) => {
        const r = db.transaction('photos', 'readwrite').objectStore('photos').delete(id);
        r.onsuccess = () => res();
        r.onerror   = () => rej(r.error);
      }));
    }

    function idbGetByJob(jobId) {
      return openIDB().then(db => new Promise((res, rej) => {
        const r = db.transaction('photos', 'readonly')
                    .objectStore('photos').index('jobId').getAll(jobId);
        r.onsuccess = () => res(r.result);
        r.onerror   = () => rej(r.error);
      }));
    }

    function ls(key, def) {
      try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? def; }
      catch { return def; }
    }
    function lsSave(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

    function blobToDataUrl(blob) {
      return new Promise(resolve => {
        const r = new FileReader();
        r.onload = e => resolve(e.target.result);
        r.readAsDataURL(blob);
      });
    }

    return {
      /* Users */
      async saveUserProfile(userId, data) {
        const users = ls('demo_users', {});
        users[userId] = { uid: userId, ...data };
        lsSave('demo_users', users);
      },
      async saveFCMToken() {},
      async getUsers() { return Object.values(ls('demo_users', {})); },

      /* Jobs */
      listenJobs(callback) {
        callback(ls('demo_jobs', []));
        return () => {};
      },
      async addJob(data) {
        const id   = uid();
        const jobs = ls('demo_jobs', []);
        jobs.unshift({ ...data, id, createdAt: new Date().toISOString() });
        lsSave('demo_jobs', jobs);
        return id;
      },
      async updateJob(id, data) {
        const jobs = ls('demo_jobs', []);
        const i    = jobs.findIndex(j => j.id === id);
        if (i !== -1) { jobs[i] = { ...jobs[i], ...data }; lsSave('demo_jobs', jobs); }
      },
      async deleteJob(id) {
        const photos = await idbGetByJob(id);
        await Promise.all(photos.map(p => idbDelete(p.id)));
        lsSave('demo_jobs', ls('demo_jobs', []).filter(j => j.id !== id));
      },

      /* Photos */
      listenJobPhotos(jobId, callback) {
        idbGetByJob(jobId).then(photos =>
          callback(photos.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1)))
        );
        return () => {};
      },
      async getJobPhotos(jobId) { return idbGetByJob(jobId); },
      async uploadPhoto(jobId, file, onProgress) {
        if (onProgress) onProgress(30);
        const originalUrl = await blobToDataUrl(file);
        if (onProgress) onProgress(100);
        const photo = {
          id: uid(), jobId, originalUrl,
          annotatedUrl: null, annotationsUrl: null,
          originalPath: null, annotatedPath: null, annotationsPath: null,
          tags: [], createdAt: new Date().toISOString(),
        };
        await idbPut(photo);
        return photo;
      },
      async deletePhoto(id) { await idbDelete(id); },
      async saveAnnotations(photoId, annotatedBlob, annotationsBlob) {
        const [annotatedUrl, annotationsUrl] = await Promise.all([
          blobToDataUrl(annotatedBlob),
          blobToDataUrl(annotationsBlob),
        ]);
        const existing = await idbGet(photoId);
        if (existing) await idbPut({ ...existing, annotatedUrl, annotationsUrl });
        return { annotatedUrl, annotationsUrl };
      },
      async updatePhotoTags(photoId, tags) {
        const existing = await idbGet(photoId);
        if (existing) await idbPut({ ...existing, tags });
      },

      /* Notifications */
      async addNotification(data) {
        const notifs = ls('demo_notifs', []);
        notifs.unshift({ ...data, id: uid(), read: false, createdAt: new Date().toISOString() });
        lsSave('demo_notifs', notifs);
      },
      listenNotifications(toUid, callback) {
        callback(ls('demo_notifs', []).filter(n => n.toUid === toUid));
        return () => {};
      },
      async markAllNotificationsRead(toUid) {
        lsSave('demo_notifs', ls('demo_notifs', []).map(n =>
          n.toUid === toUid ? { ...n, read: true } : n
        ));
      },
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     FIREBASE BACKEND  (Production — Firestore + Storage)
  ═══════════════════════════════════════════════════════════════════════ */
  function buildFirebaseDB() {
    const fs  = () => firebase.firestore();
    const st  = () => firebase.storage();

    return {
      /* Users */
      async saveUserProfile(userId, data) {
        await fs().collection('users').doc(userId).set(
          { ...data, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
      },
      async saveFCMToken(userId, token) {
        await fs().collection('users').doc(userId).update({ fcmToken: token });
      },
      async getUsers() {
        const snap = await fs().collection('users').get();
        return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
      },

      /* Jobs */
      listenJobs(callback) {
        return fs().collection('jobs').orderBy('createdAt', 'desc')
          .onSnapshot(snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      },
      async addJob(data) {
        const ref = fs().collection('jobs').doc();
        await ref.set({
          ...data,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          createdBy: firebase.auth().currentUser?.uid || null,
        });
        return ref.id;
      },
      async updateJob(id, data) { await fs().collection('jobs').doc(id).update(data); },
      async deleteJob(id) {
        const photos = await this.getJobPhotos(id);
        await Promise.all(photos.map(p => this.deletePhoto(p.id)));
        await fs().collection('jobs').doc(id).delete();
      },

      /* Photos */
      listenJobPhotos(jobId, callback) {
        return fs().collection('photos').where('jobId', '==', jobId)
          .onSnapshot(snap => {
            const photos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
              .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
            callback(photos);
          });
      },
      async getJobPhotos(jobId) {
        const snap = await fs().collection('photos').where('jobId', '==', jobId).get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      },
      async uploadPhoto(jobId, file, onProgress) {
        const photoId   = uid();
        const ext       = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const path      = `photos/${photoId}/original.${ext}`;
        const uploadRef = st().ref(path);
        const task      = uploadRef.put(file);
        if (onProgress) {
          task.on('state_changed', snap => {
            onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
          });
        }
        await task;
        const originalUrl = await uploadRef.getDownloadURL();
        const photoData = {
          id: photoId, jobId, originalPath: path, originalUrl,
          annotatedUrl: null, annotatedPath: null,
          annotationsUrl: null, annotationsPath: null,
          tags: [],
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          createdBy: firebase.auth().currentUser?.uid || null,
        };
        await fs().collection('photos').doc(photoId).set(photoData);
        return photoData;
      },
      async deletePhoto(photoId) {
        const doc = await fs().collection('photos').doc(photoId).get();
        if (!doc.exists) return;
        const data  = doc.data();
        const paths = [data.originalPath, data.annotatedPath, data.annotationsPath].filter(Boolean);
        await Promise.all(paths.map(p => st().ref(p).delete().catch(() => {})));
        await fs().collection('photos').doc(photoId).delete();
      },
      async saveAnnotations(photoId, annotatedBlob, annotationsBlob) {
        const [annSnap, layerSnap] = await Promise.all([
          st().ref(`photos/${photoId}/annotated.jpg`).put(annotatedBlob,  { contentType: 'image/jpeg' }),
          st().ref(`photos/${photoId}/annotations.png`).put(annotationsBlob, { contentType: 'image/png' }),
        ]);
        const [annotatedUrl, annotationsUrl] = await Promise.all([
          annSnap.ref.getDownloadURL(),
          layerSnap.ref.getDownloadURL(),
        ]);
        await fs().collection('photos').doc(photoId).update({
          annotatedUrl,  annotatedPath:   `photos/${photoId}/annotated.jpg`,
          annotationsUrl, annotationsPath: `photos/${photoId}/annotations.png`,
        });
        return { annotatedUrl, annotationsUrl };
      },
      async updatePhotoTags(photoId, tags) {
        await fs().collection('photos').doc(photoId).update({ tags });
      },

      /* Notifications */
      async addNotification(data) {
        await fs().collection('notifications').add({
          ...data, read: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      },
      listenNotifications(toUid, callback) {
        return fs().collection('notifications').where('toUid', '==', toUid)
          .onSnapshot(snap => {
            const notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
              .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
            callback(notifs);
          });
      },
      async markAllNotificationsRead(toUid) {
        const snap = await fs().collection('notifications')
          .where('toUid', '==', toUid).where('read', '==', false).get();
        const batch = fs().batch();
        snap.docs.forEach(d => batch.update(d.ref, { read: true }));
        await batch.commit();
      },
    };
  }

  return window.DEMO_MODE ? buildLocalDB() : buildFirebaseDB();
})();
