// Public AniList notification renderer/styles checked on 2026-10-18:
// https://anilist.co/js/main.1dc97617.js (Ll, scope 4fbfd7b4)
// https://anilist.co/css/main.31bf02e3.css
// In particular, activity names link to the activity, not to the user. Every
// native child carries the Vue scope; media notifications use .cover, not .avatar.
const scoped = (markup: string) => markup.replace(/<([a-z][a-z0-9]*)(?=[\s>])/g, '<$1 data-v-4fbfd7b4');
const time = '<div class="time"><time>3 days ago</time></div>';
export const nativeActivity = (id: number, user = 'Alice', wording = 'liked your activity.') => scoped(
  `<div class="notification"><a class="avatar" href="/user/${user}/"></a><div class="details"><div><a class="link" href="/activity/${id}">${user} <span class="context">${wording}</span></a></div>${time}</div></div>`);
export const nativeAddition = (id: number, title: string, cover = true) => scoped(
  `<div class="notification hasMedia">${cover ? `<a class="cover" href="/anime/${id}/"></a>` : ''}<div class="details"><div><a class="link" href="/anime/${id}/">${title}</a> <span class="context">was recently added to the site.</span></div>${time}</div></div>`);
export const nativeChanges = (id: number, title: string) => scoped(
  `<div class="notification hasMedia"><a class="cover" href="/manga/${id}/"></a><div class="details"><div><a class="link" href="/manga/${id}/">${title}</a> <span class="context">received site data changes</span><div class="reason-text" hidden>updated final chapter count</div><div class="context expand-reason reason">Show reason...</div></div>${time}</div></div>`);
export const nativeForum = (user: string, comment = 456) => scoped(
  `<div class="notification"><a class="avatar" href="/user/${user}/"></a><div class="details"><div><a class="link" href="/forum/thread/123/comment/${comment}">${user} <span class="context">liked your comment, in the forum thread</span> <span>life changing anime</span></a></div>${time}</div></div>`);

export const nativeNotificationCSS = `
  .notification[data-v-4fbfd7b4]{background:rgb(var(--color-foreground));border-radius:4px;display:grid;font-size:1.5rem;grid-template-columns:60px auto;margin-bottom:25px;min-height:70px;overflow:hidden;position:relative}
  .notification.hasMedia[data-v-4fbfd7b4]{grid-template-columns:60px auto}
  .unread[data-v-4fbfd7b4]{box-shadow:0 3px 10px rgba(49,54,68,.1);border-right:solid 6px rgb(var(--color-blue))}
  .details[data-v-4fbfd7b4]{display:flex;flex-direction:column;justify-content:center;min-height:70px;padding:14px 16px;padding-right:100px}
  .details .link[data-v-4fbfd7b4]{color:rgb(var(--color-blue))}
  .details .context[data-v-4fbfd7b4]{color:rgb(var(--color-text))}
  .time[data-v-4fbfd7b4]{color:rgb(var(--color-text-lighter));font-size:1.1rem;position:absolute;right:12px;top:12px}
  .avatar[data-v-4fbfd7b4],.cover[data-v-4fbfd7b4]{background-position:50%;background-repeat:no-repeat;background-size:cover}
  .expand-reason[data-v-4fbfd7b4]{cursor:pointer;font-size:1.2rem;margin-top:8px}
`;
