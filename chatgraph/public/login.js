document.querySelector('#login').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: document.querySelector('#password').value }) });
    if (!response.ok) throw new Error((await response.json()).error);
    location.replace('/');
  } catch (error) { document.querySelector('#error').textContent = error.message || '暂时无法登录。'; }
  finally { button.disabled = false; }
});
