import { CONTENT_TYPE_FORM_URLENCODED } from '../../common/constants';

// The body sent as POSTFIELDS: a urlencoded form, or the text when there is a
// mime type or the method expects a body. Files and multipart go another way.
export const parseRequestBody = ({ body, method }: { body: any; method: string }) => {
  const isUrlEncodedForm = body.mimeType === CONTENT_TYPE_FORM_URLENCODED;
  const expectsBody = ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase());
  const hasMimetypeAndUpdateMethod = typeof body.mimeType === 'string' || expectsBody;
  if (isUrlEncodedForm) {
    const urlSearchParams = new URLSearchParams();
    (body.params || []).map((p: { name: string; value: any }) => urlSearchParams.append(p.name, p?.value || ''));
    return urlSearchParams.toString();
  }

  if (hasMimetypeAndUpdateMethod) {
    return body.text || '';
  }

  return undefined;
};
