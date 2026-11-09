
import './index.css';

interface BrowserAPI {
  navigate: (url: string) => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
  onUrlChanged: (callback: (url: string) => void) => void;
}

declare global {
  interface Window {
    browser: BrowserAPI;
  }
}

const address = document.querySelector<HTMLInputElement>('#address')!;
const go = document.querySelector<HTMLButtonElement>('#go')!;
const back = document.querySelector<HTMLButtonElement>('#back')!;
const forward = document.querySelector<HTMLButtonElement>('#forward')!;
const reload = document.querySelector<HTMLButtonElement>('#reload')!;

function navigate() {
  window.browser.navigate(address.value);
  address.blur();
}

go.addEventListener('click', navigate);

address.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') navigate();
});

back.addEventListener('click', () => window.browser.back());
forward.addEventListener('click', () => window.browser.forward());
reload.addEventListener('click', () => window.browser.reload());

window.browser.onUrlChanged((url) => {
  address.value = url;
});

window.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    address.focus();
    address.select();
  }
});
