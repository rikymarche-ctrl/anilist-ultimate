import { describe, expect, it } from 'vitest';
import { plainActivityText } from './NotificationSnippet';

describe('plainActivityText', () => {
  it.each([
    ['__Hi ExAstra!__ I love', 'Hi ExAstra! I love'],
    ['wow.\n\n__img220(https://x.co/a.gif)__', 'wow.'],
    ['_Img(https://x.co/a.gif)_ after', 'after'],
    ['____Hey everyone!____\n\nnext', 'Hey everyone! next'],
    ['***both*** and ___both___', 'both and both'],
    ['`code` and ```block```', 'code and block'],
    ['- one\n+ two\n* three\n1. four', 'one two three four'],
    ['above\n---\n***\n___\nbelow', 'above below'],
    ['> # quoted title', 'quoted title'],
    ['![alt](https://x.co/a.png) after', 'after'],
    ['img50%(https://x.co/a.png) after', 'after'],
    ['one<br>two<br/>three', 'one two three'],
    ['<h1>Title</h1><p>Body <b>bold</b>er</p>', 'Title Body bolder'],
    ['\\*\\*literal\\*\\* \\_x\\_', '**literal** _x_'],
    ['Tom &amp; Jerry&#39;s &lt;3&nbsp;&#x2764;', "Tom & Jerry's <3 ❤"],
    ['&bogus; &#0;', '&bogus; &#0;'],
  ])('reduces %j to plain text', (raw, expected) => {
    expect(plainActivityText(raw)).toBe(expected);
  });

  it('strips bold and underline markers around text', () => {
    expect(plainActivityText('__Hi ExAstra!__ I love')).toBe('Hi ExAstra! I love');
    expect(plainActivityText('**bold** and ~~gone~~')).toBe('bold and gone');
  });

  it('removes media embeds and returns empty text for image-only activity', () => {
    expect(plainActivityText('img300(https://files.catbox.moe/a.png)')).toBe('');
    expect(plainActivityText('img(https://i.imgur.com/x.jpg)')).toBe('');
    expect(plainActivityText('webm(https://files.catbox.moe/a.webm) look')).toBe('look');
    expect(plainActivityText('youtube(https://youtu.be/pAkUQwY9_Mk)')).toBe('');
  });

  it('removes spoiler markers but keeps the spoiler text', () => {
    expect(plainActivityText('~!secret ending!~')).toBe('secret ending');
    expect(plainActivityText('~~~hidden block~~~')).toBe('hidden block');
  });

  it('removes HTML tags and keeps their text', () => {
    expect(plainActivityText('<center><a href="/user/x">@x</a> wow</center>')).toBe('@x wow');
    expect(plainActivityText('<!-- note -->kept')).toBe('kept');
  });

  it('turns markdown links into their label', () => {
    expect(plainActivityText('see [Yoruichi](https://anilist.co/character/908)')).toBe(
      'see Yoruichi'
    );
  });

  it('drops leading heading and quote markers per line', () => {
    expect(plainActivityText('# Title\n> quoted line')).toBe('Title quoted line');
  });

  it('removes surrounding single underscore or asterisk emphasis', () => {
    expect(plainActivityText('_soft_ and *loud*')).toBe('soft and loud');
  });

  it('keeps underscores inside words', () => {
    expect(plainActivityText('snake_case_name')).toBe('snake_case_name');
  });

  it('collapses whitespace and trims', () => {
    expect(plainActivityText('  a \n\n  b\t c  ')).toBe('a b c');
  });

  it('returns empty text for non-string or empty input', () => {
    expect(plainActivityText('')).toBe('');
    expect(plainActivityText(undefined as unknown as string)).toBe('');
  });
});
