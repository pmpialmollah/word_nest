import { initFirebase, onAuthStateChanged, signUpWithEmail, signInWithEmail, resetPassword } from './firebase-config.js';

initFirebase();
const backdrop = document.getElementById('authModalBackdrop');
let mode = 'login';

function openAuth(nextMode){
  mode = nextMode;
  document.getElementById('authModalTitle').textContent = mode === 'signup' ? 'Create an account' : 'Login';
  document.getElementById('confirmAuthBtn').textContent = mode === 'signup' ? 'Create account' : 'Login';
  backdrop.classList.add('show');
  backdrop.setAttribute('aria-hidden', 'false');
  document.getElementById('authEmail').focus();
}
function closeAuth(){
  backdrop.classList.remove('show');
  backdrop.setAttribute('aria-hidden', 'true');
}
function showToast(message){
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2400);
}

document.getElementById('loginBtn').onclick = () => openAuth('login');
document.getElementById('signupBtn').onclick = () => openAuth('signup');
document.getElementById('cancelAuthBtn').onclick = closeAuth;
backdrop.onclick = event => { if(event.target === backdrop) closeAuth(); };
document.getElementById('confirmAuthBtn').onclick = async () => {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  if(!email || !password){ showToast('Provide email and password'); return; }
  try{
    if(mode === 'signup') await signUpWithEmail(email, password);
    else await signInWithEmail(email, password);
    window.location.replace('index.html');
  }catch(error){
    console.error(error);
    showToast(error.message || 'Authentication failed');
  }
};
document.getElementById('forgotPasswordBtn').onclick = async () => {
  const email = document.getElementById('authEmail').value.trim();
  if(!email){ showToast('Enter your email first'); document.getElementById('authEmail').focus(); return; }
  try{
    await resetPassword(email);
    showToast('Password reset email sent');
  }catch(error){
    console.error(error);
    showToast(error.message || 'Could not send reset email');
  }
};
document.getElementById('authPassword').addEventListener('keydown', event => {
  if(event.key === 'Enter') document.getElementById('confirmAuthBtn').click();
});

onAuthStateChanged(user => {
  if(user) window.location.replace('index.html');
});
