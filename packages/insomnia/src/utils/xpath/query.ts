import { DOMParser } from '@xmldom/xmldom';
import xpath, { SelectedValue } from 'xpath';

/**
 * Query an XML blob with XPath
 */
// Guard against overly complex/long expressions that could be used to cause
// excessive resource consumption (denial of service) when evaluated.
const MAX_XPATH_QUERY_LENGTH = 1000;

export const queryXPath = (xml: string, query?: string) => {
  const dom = new DOMParser().parseFromString(xml);
  let selectedValues: SelectedValue[] = [];
  if (query === undefined) {
    throw new Error('Must pass an XPath query.');
  }
  if (typeof query !== 'string' || query.length > MAX_XPATH_QUERY_LENGTH) {
    throw new Error('Invalid XPath query.');
  }
  try {
    selectedValues = xpath.select(query, dom);
  } catch (err) {
    // Avoid reflecting the raw, unsanitized query back to the caller.
    throw new Error('Invalid XPath query.');
  }
  // Functions return plain strings
  if (typeof selectedValues === 'string') {
    return [{ outer: selectedValues, inner: selectedValues }];
  }

  return (selectedValues as Node[])
    .filter(sv => sv.nodeType === Node.ATTRIBUTE_NODE
      || sv.nodeType === Node.ELEMENT_NODE
      || sv.nodeType === Node.TEXT_NODE)
    .map(selectedValue => {
      const outer = selectedValue.toString().trim();
      if (selectedValue.nodeType === Node.ATTRIBUTE_NODE) {
        return { outer, inner: selectedValue.nodeValue };
      }
      if (selectedValue.nodeType === Node.ELEMENT_NODE) {
        return { outer, inner: selectedValue.childNodes.toString() };
      }
      if (selectedValue.nodeType === Node.TEXT_NODE) {
        return { outer, inner: selectedValue.toString().trim() };
      }
      return { outer, inner: null };
    });

};
