import {useExtracted} from 'next-intl';
const t = useExtracted();
t['rich']('Welcome <b>home</b>', {b: (chunks) => <b>{chunks}</b>});
