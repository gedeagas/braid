import { ChevronLeft } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/ui/theme';
import { CornerInset } from './CornerInset';
import { IconButton } from './IconButton';

export function HeaderBackButton({
  onPress,
  accessibilityLabel,
}: {
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const { t } = useTranslation();
  const { palette: c } = useTheme();
  return (
    <>
      <CornerInset />
      <IconButton
        icon={<ChevronLeft color={c.text} size={25} />}
        onPress={onPress}
        accessibilityLabel={accessibilityLabel ?? t('common.back')}
        style={{ marginLeft: -8 }}
      />
    </>
  );
}
