const paths = {
  chat: "M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3V6a2 2 0 0 1 1-2Z M8 9h8 M8 13h5",
  panel: "M4 4h16v16H4z M9 4v16",
  plus: "M12 5v14 M5 12h14",
  folder: "M3 7V5h6l2 2h10v13H3z",
  clear: "m5 15 9-11 7 6-9 11H9z M12 21h9 M8 12l7 6",
  send: "M12 19V5 M6 11l6-6 6 6",
  stop: "M6 6h12v12H6z",
};

export function ChatIcon({ name }: { name: keyof typeof paths }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
