'use strict';

const form = document.querySelector('#generator');
const accountField = document.querySelector('#account');
const error = document.querySelector('#error');
const result = document.querySelector('#result');
const manifestField = document.querySelector('#manifest-url');
const copy = document.querySelector('#copy');

function parseAccount(raw) {
  let input = raw.trim();
  if (/^https?:\/\//i.test(input)) {
    let url;
    try { url = new URL(input); } catch { throw new Error('That is not a valid URL.'); }
    if (!['letterboxd.com', 'www.letterboxd.com'].includes(url.hostname.toLowerCase()) || url.protocol !== 'https:') {
      throw new Error('Please use a public letterboxd.com URL.');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 1 || parts.length > 2 || (parts.length === 2 && parts[1] !== 'watchlist')) {
      throw new Error('Use a Letterboxd profile URL or watchlist URL.');
    }
    input = parts[0];
  } else {
    input = input.replace(/^@/, '');
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(input)) {
    throw new Error('Enter a valid username (letters, numbers, underscores or hyphens).');
  }
  return input.toLowerCase();
}

form.addEventListener('submit', event => {
  event.preventDefault();
  result.hidden = true;
  error.hidden = true;
  try {
    const username = parseAccount(accountField.value);
    const manifest = new URL(`/u/${encodeURIComponent(username)}/manifest.json`, location.origin).href;
    manifestField.value = manifest;
    document.querySelector('#view-manifest').href = manifest;
    document.querySelector('#view-watchlist').href = `https://letterboxd.com/${encodeURIComponent(username)}/watchlist/`;
    copy.textContent = 'Copy';
    result.hidden = false;
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
  }
});

copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(manifestField.value);
    copy.textContent = 'Copied!';
  } catch {
    manifestField.select();
    copy.textContent = 'Select and copy';
  }
});
