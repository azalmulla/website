const form = document.getElementById('workflowForm');
const successMsg = document.getElementById('successMsg');

form.addEventListener('submit', (e) => {
  e.preventDefault();

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const btn = form.querySelector('.btn-submit');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  // Simulate async submission — replace with real fetch() when backend is ready
  setTimeout(() => {
    form.hidden = true;
    successMsg.hidden = false;
    successMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 800);
});
