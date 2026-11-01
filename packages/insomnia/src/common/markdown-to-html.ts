import dompurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({
  renderer: new marked.Renderer(),
  gfm: true,
  breaks: false,
  pedantic: false,
  smartLists: true,
  smartypants: false,
});

// Without styles, which could dress the page up as the app's own, or remote
// images, which tell their server who opened the docs and when: an image
// keeps its alt text, and a data: one shows.
const withoutRemoteImages = (node: Element) => {
  if (node.tagName === 'IMG' && !/^data:image\//i.test(node.getAttribute('src') || '')) {
    node.removeAttribute('src');
    node.removeAttribute('srcset');
  }
};

export const markdownToHTML = (input: string) => {
  dompurify.addHook('afterSanitizeAttributes', withoutRemoteImages);
  try {
    return dompurify.sanitize(marked.parse(input), { FORBID_TAGS: ['style'], FORBID_ATTR: ['style'] });
  } finally {
    dompurify.removeHook('afterSanitizeAttributes');
  }
};
