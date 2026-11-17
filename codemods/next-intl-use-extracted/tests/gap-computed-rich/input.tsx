import {useTranslations} from 'next-intl';
const t = useTranslations('Home');
t['rich']('body', {b: (chunks) => <b>{chunks}</b>});
