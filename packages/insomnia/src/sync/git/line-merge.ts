// A three-way merge of text by lines, as git (and isomorphic-git's own merge
// driver) does it: for the repository's other files, and for a long field of
// a document (a spec, a body, a script) that both sides changed in different places.
import diff3Merge from 'diff3';

const LINES = /^.*(\r?\n|$)/gm;

export function mergeLines(base: string, ours: string, theirs: string, names: [string, string] = ['ours', 'theirs']) {
  const blocks = diff3Merge(ours.match(LINES) || [], base.match(LINES) || [], theirs.match(LINES) || []);
  let mergedText = '';
  let cleanMerge = true;
  for (const block of blocks) {
    if (block.ok) {
      mergedText += block.ok.join('');
    }
    if (block.conflict) {
      cleanMerge = false;
      mergedText += `<<<<<<< ${names[0]}\n${block.conflict.a.join('')}=======\n${block.conflict.b.join('')}>>>>>>> ${names[1]}\n`;
    }
  }
  return { cleanMerge, mergedText };
}
