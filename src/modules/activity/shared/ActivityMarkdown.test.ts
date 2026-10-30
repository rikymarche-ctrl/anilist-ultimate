import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activateMarkdownInteractions, renderActivityMarkdown } from './ActivityMarkdown';

const YT_ID = 'pAkUQwY9_Mk';

function render(html: string): HTMLDivElement {
  const host = document.createElement('div');
  host.append(renderActivityMarkdown(html));
  return host;
}

function mountContainer(html: string): HTMLDivElement {
  const container = document.createElement('div');
  container.append(renderActivityMarkdown(html));
  document.body.append(container);
  return container;
}

describe('renderActivityMarkdown: allowed formatting', () => {
  it('keeps headings, centering, strong, links, paragraphs, breaks, rules, and code', () => {
    const host = render(
      '<h1><center><a href="/user/alice"><strong>Title</strong></a></center></h1>' +
        '<p>one<br>two</p><hr><pre><code class="language-ts">const a = 1;</code></pre>'
    );
    expect(host.querySelector('h1 center a[href="/user/alice"] strong')?.textContent).toBe('Title');
    expect(host.querySelector('p br')).not.toBeNull();
    expect(host.querySelector('hr')).not.toBeNull();
    expect(host.querySelector('pre code.language-ts')?.textContent).toBe('const a = 1;');
  });

  it('unwraps tags outside the whitelist and keeps their sanitized children', () => {
    const host = render('<h6><mark>kept</mark></h6>');
    expect(host.querySelector('h6, mark')).toBeNull();
    expect(host.textContent).toBe('kept');
  });

  it('drops comments but keeps text', () => {
    expect(render('<!-- hidden -->visible').textContent).toBe('visible');
  });
});

describe('renderActivityMarkdown: XSS vectors', () => {
  const vectors = [
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '<a href="JaVaScRiPt:alert(1)">x</a>',
    '<a href=" java\tscript:alert(1)">x</a>',
    '<svg onload=alert(1)>',
    '<iframe src=https://evil.example></iframe>',
    '<math><mi xlink:href=javascript:alert(1)>x</mi></math>',
    '<div style="background:url(javascript:x)">d</div>',
    '<form action=javascript:x><button>go</button></form>',
    '<a href="//evil.com">x</a>',
    '<img src="data:image/svg+xml;base64,PHN2Zy8+">',
    '<img src="http://insecure.example/a.png">',
    '<script>alert(1)</script>ok',
  ];

  it.each(vectors)('neutralises %s', (vector) => {
    const host = render(vector);
    expect(host.querySelector('script, iframe, svg, math, form, button, style')).toBeNull();
    for (const element of Array.from(host.querySelectorAll('*'))) {
      expect(element.hasAttribute('style')).toBe(false);
      for (const attribute of Array.from(element.attributes)) {
        expect(attribute.name.startsWith('on')).toBe(false);
      }
    }
    expect(host.innerHTML).not.toMatch(/javascript|alert\(|evil|data:|insecure/i);
  });

  it('drops an img whose src is not absolute https', () => {
    expect(render('<img src="/relative.png">').querySelector('img')).toBeNull();
  });
});

describe('renderActivityMarkdown: links', () => {
  it('marks external links with target and rel', () => {
    const link = render('<a href="https://example.com/page">out</a>').querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/page');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it('turns anilist.co absolute links into paths', () => {
    const link = render('<a href="https://anilist.co/anime/1?x=1#y">in</a>').querySelector('a');
    expect(link?.getAttribute('href')).toBe('/anime/1?x=1#y');
    expect(link?.hasAttribute('target')).toBe(false);
  });

  it('keeps relative anilist paths and rejects protocol-relative ones', () => {
    expect(render('<a href="/user/bob">b</a>').querySelector('a')?.getAttribute('href')).toBe(
      '/user/bob'
    );
    expect(render('<a href="/\\evil.com">b</a>').querySelector('a')?.hasAttribute('href')).toBe(
      false
    );
  });
});

describe('renderActivityMarkdown: media', () => {
  it('keeps spoilers with their nested span', () => {
    const spoiler = render(
      "<span class='markdown_spoiler'><span>secret</span></span>"
    ).querySelector('.markdown_spoiler');
    expect(spoiler?.querySelector('span')?.textContent).toBe('secret');
  });

  it('keeps image width and drops http sources', () => {
    const image = render(
      "<img width='420' src='https://files.catbox.moe/oji672.jpg'>"
    ).querySelector('img');
    expect(image?.getAttribute('width')).toBe('420');
    expect(image?.getAttribute('src')).toBe('https://files.catbox.moe/oji672.jpg');
    expect(image?.getAttribute('loading')).toBe('lazy');
    expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('removes autoplay from video, sets controls, and keeps the https source', () => {
    const host = render(
      "<video muted loop autoplay controls><source src='https://files.catbox.moe/4ft0kc.mp4'>Your browser does not support the video tag.</video>"
    );
    const video = host.querySelector('video');
    expect(video?.hasAttribute('autoplay')).toBe(false);
    expect(video?.hasAttribute('controls')).toBe(true);
    expect(video?.hasAttribute('muted')).toBe(true);
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect(host.querySelector('source')?.getAttribute('src')).toBe(
      'https://files.catbox.moe/4ft0kc.mp4'
    );
  });

  it('drops a video whose source is javascript:', () => {
    expect(
      render('<video controls><source src="javascript:alert(1)"></video>').querySelector('video')
    ).toBeNull();
  });
});

describe('renderActivityMarkdown: YouTube', () => {
  it.each([
    `https://youtu.be/${YT_ID}?si=OlY19Hm5mtwMfb--`,
    YT_ID,
    `https://www.youtube.com/watch?v=${YT_ID}&t=10`,
    `https://m.youtube.com/embed/${YT_ID}`,
    `https://youtube.com/shorts/${YT_ID}`,
  ])('renders a thumbnail card for %s', (id) => {
    const card = render(`<div class='youtube' id='${id}'></div>`).querySelector<HTMLElement>(
      '.au-youtube'
    );
    expect(card?.dataset.videoId).toBe(YT_ID);
    expect(card?.getAttribute('role')).toBe('button');
    expect(card?.getAttribute('tabindex')).toBe('0');
    expect(card?.querySelector('img')?.getAttribute('src')).toBe(
      `https://i.ytimg.com/vi/${YT_ID}/hqdefault.jpg`
    );
  });

  it.each([
    'https://evil.example/watch?v=pAkUQwY9_Mk',
    'https://youtube.com/watch?v=short',
    'nope',
    'javascript:alert(1)',
  ])('drops the div for invalid id %s', (id) => {
    expect(
      render(`<div class='youtube' id='${id}'></div>`).querySelector('.au-youtube')
    ).toBeNull();
  });
});

describe('renderActivityMarkdown: limits', () => {
  it('drops content nested deeper than 64 levels without throwing', () => {
    const nested = (depth: number, leaf: string): string =>
      `${'<div>'.repeat(depth)}${leaf}${'</div>'.repeat(depth)}`;
    expect(render(nested(10, 'shallow')).textContent).toContain('shallow');
    expect(() => render(nested(200, 'deepest'))).not.toThrow();
    expect(render(nested(200, 'deepest')).textContent).not.toContain('deepest');
  });

  it('renders input over 200k characters as a single text node without parsing', () => {
    const html = '<img src="https://example.com/a.png">' + 'a'.repeat(200_000);
    const fragment = renderActivityMarkdown(html);
    expect(fragment.childNodes.length).toBe(1);
    expect(fragment.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect((fragment.firstChild as Text).data.length).toBe(200_000);
    expect(fragment.querySelector('img')).toBeNull();
  });
});

describe('activateMarkdownInteractions', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('toggles the revealed class on spoiler click', () => {
    const container = mountContainer("<span class='markdown_spoiler'><span>secret</span></span>");
    const cleanup = activateMarkdownInteractions(container);
    const spoiler = container.querySelector<HTMLElement>('.markdown_spoiler')!;
    const inner = spoiler.querySelector<HTMLElement>('span')!;

    inner.click();
    expect(spoiler.classList.contains('au-spoiler-revealed')).toBe(true);
    inner.click();
    expect(spoiler.classList.contains('au-spoiler-revealed')).toBe(false);
    cleanup();
  });

  it('inserts a YouTube iframe on click', () => {
    const container = mountContainer(`<div class='youtube' id='${YT_ID}'></div>`);
    const cleanup = activateMarkdownInteractions(container);
    const card = container.querySelector<HTMLElement>('.au-youtube')!;

    card.click();
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('src')).toBe(`https://www.youtube.com/embed/${YT_ID}?autoplay=1`);
    expect(iframe?.getAttribute('title')).toBe('YouTube video');
    expect(card.hasAttribute('role')).toBe(false);
    expect(card.hasAttribute('tabindex')).toBe(false);
    cleanup();
  });

  it.each(['Enter', ' '])('activates YouTube on keydown %j', (key) => {
    const container = mountContainer(`<div class='youtube' id='${YT_ID}'></div>`);
    const cleanup = activateMarkdownInteractions(container);
    const card = container.querySelector<HTMLElement>('.au-youtube')!;

    card.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    expect(container.querySelector('iframe')).not.toBeNull();
    cleanup();
  });

  it('ignores other keys on the YouTube card', () => {
    const container = mountContainer(`<div class='youtube' id='${YT_ID}'></div>`);
    const cleanup = activateMarkdownInteractions(container);
    const card = container.querySelector<HTMLElement>('.au-youtube')!;

    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(container.querySelector('iframe')).toBeNull();
    cleanup();
  });

  it('returns a no-op cleanup on double activation and stops listeners on cleanup', () => {
    const container = mountContainer("<span class='markdown_spoiler'><span>secret</span></span>");
    const spoiler = container.querySelector<HTMLElement>('.markdown_spoiler')!;
    const first = activateMarkdownInteractions(container);
    const second = activateMarkdownInteractions(container);

    second();
    spoiler.click();
    expect(spoiler.classList.contains('au-spoiler-revealed')).toBe(true);

    first();
    spoiler.click();
    expect(spoiler.classList.contains('au-spoiler-revealed')).toBe(true);
  });
});
