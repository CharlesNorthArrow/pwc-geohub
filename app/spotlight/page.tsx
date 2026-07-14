import type { Metadata } from 'next';
import SpotlightPicker from '../../src/components/spotlight/SpotlightPicker';

export const metadata: Metadata = {
  title: 'Spotlight',
  description:
    'Pick a PWC school to build a shareable spotlight card — auto-selected school and community outliers for fundraising or celebration.',
};

export default function SpotlightPage(): React.JSX.Element {
  return <SpotlightPicker />;
}
