import {useExtracted} from 'next-intl';
export default function Home() {
  const t = useExtracted();
  return <h1 title={t('Start')}>{t('Hello')}</h1>;
}
