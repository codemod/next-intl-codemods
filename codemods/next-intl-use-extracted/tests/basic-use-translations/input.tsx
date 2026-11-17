import {useTranslations} from 'next-intl';
export default function Home() {
  const t = useTranslations('Home');
  return <h1 title={t('cta')}>{t('title')}</h1>;
}
