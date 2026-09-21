import '../vocab-app.css';

const page = window.location.pathname.split('/').pop() || 'index.html';
const pages = {
  'home.html': () => import('../home.js'),
  'notes.html': () => import('../notes.js'),
  'settings.html': () => import('../settings.js'),
  'index.html': () => import('../vocab-app.js'),
  '': () => import('../vocab-app.js')
};

(pages[page] || pages['index.html'])();