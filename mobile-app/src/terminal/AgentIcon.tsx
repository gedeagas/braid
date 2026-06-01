import { Image } from 'expo-image';
import { useId, useState } from 'react';
import { View, Text } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import type { JSX } from 'react';

import { useTheme } from '@/ui/theme';
import { getAgentEntry } from './agentCatalog';

/** Brand icons receive the resolved foreground color so they theme with the app. */
type BrandIconProps = { size: number; color: string };

function AgentLetterIcon({ letter, size }: { letter: string; size: number }) {
  const { palette: colors } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 3,
        borderWidth: 1.5,
        borderColor: colors.subtle,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          color: colors.text,
          fontSize: Math.max(8, Math.floor(size * 0.56)),
          fontWeight: '700',
          lineHeight: Math.max(8, Math.floor(size * 0.62)),
        }}
      >
        {letter}
      </Text>
    </View>
  );
}

function AgentFaviconIcon({ domain, size, fallbackLetter }: { domain: string; size: number; fallbackLetter: string }) {
  const [hasError, setHasError] = useState(false);
  const fetchSize = size >= 28 ? 64 : 32;
  const src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${fetchSize}`;

  if (hasError) {
    return <AgentLetterIcon letter={fallbackLetter} size={size} />;
  }

  return (
    <Image
      source={{ uri: src }}
      style={{ width: size, height: size, borderRadius: 3 }}
      contentFit="cover"
      onError={() => setHasError(true)}
    />
  );
}

const ClaudeIcon = ({ size, color }: BrandIconProps) => (
  <Svg width={size} height={size} viewBox="0 0 512 510">
    <Path
      fill={color}
      fillRule="nonzero"
      d="M142.27 316.62l73.655-41.326 1.238-3.589-1.238-1.996-3.589-.001-12.31-.759-42.084-1.138-36.498-1.516-35.361-1.896-8.897-1.895-8.34-10.995.859-5.484 7.482-5.03 10.717.935 23.683 1.617 35.537 2.452 25.782 1.517 38.193 3.968h6.064l.86-2.451-2.073-1.517-1.618-1.517-36.776-24.922-39.81-26.338-20.852-15.166-11.273-7.683-5.687-7.204-2.451-15.721 10.237-11.273 13.75.935 3.513.936 13.928 10.716 29.749 23.027 38.848 28.612 5.687 4.727 2.275-1.617.278-1.138-2.553-4.271-21.13-38.193-22.546-38.848-10.035-16.101-2.654-9.655c-.935-3.968-1.617-7.304-1.617-11.374l11.652-15.823 6.445-2.073 15.545 2.073 6.547 5.687 9.655 22.092 15.646 34.78 24.265 47.291 7.103 14.028 3.791 12.992 1.416 3.968 2.449-.001v-2.275l1.997-26.641 3.69-32.707 3.589-42.084 1.239-11.854 5.863-14.206 11.652-7.683 9.099 4.348 7.482 10.716-1.036 6.926-4.449 28.915-8.72 45.294-5.687 30.331h3.313l3.792-3.791 15.342-20.372 25.782-32.227 11.374-12.789 13.27-14.129 8.517-6.724 16.1-.001 11.854 17.617-5.307 18.199-16.581 21.029-13.75 17.819-19.716 26.54-12.309 21.231 1.138 1.694 2.932-.278 44.536-9.479 24.062-4.347 28.714-4.928 12.992 6.066 1.416 6.167-5.106 12.613-30.71 7.583-36.018 7.204-53.636 12.689-.657.48.758.935 24.164 2.275 10.337.556h25.301l47.114 3.514 12.309 8.139 7.381 9.959-1.238 7.583-18.957 9.655-25.579-6.066-59.702-14.205-20.474-5.106-2.83-.001v1.694l17.061 16.682 31.266 28.233 39.152 36.397 1.997 8.999-5.03 7.102-5.307-.758-34.401-25.883-13.27-11.651-30.053-25.302-1.996-.001v2.654l6.926 10.136 36.574 54.975 1.895 16.859-2.653 5.485-9.479 3.311-10.414-1.895-21.408-30.054-22.092-33.844-17.819-30.331-2.173 1.238-10.515 113.261-4.929 5.788-11.374 4.348-9.478-7.204-5.03-11.652 5.03-23.027 6.066-30.052 4.928-23.886 4.449-29.674 2.654-9.858-.177-.657-2.173.278-22.37 30.71-34.021 45.977-26.919 28.815-6.445 2.553-11.173-5.789 1.037-10.337 6.243-9.2 37.257-47.392 22.47-29.371 14.508-16.961-.101-2.451h-.859l-98.954 64.251-17.618 2.275-7.583-7.103.936-11.652 3.589-3.791 29.749-20.474z"
    />
  </Svg>
);

const CodexIcon = ({ size, color }: BrandIconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <Path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" />
  </Svg>
);

const CopilotIcon = ({ size, color }: BrandIconProps) => (
  <Svg width={size} height={size} viewBox="0 0 16 16" fill={color}>
    <Path d="M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.173-1.82.822-2.558C3.012 1.454 4.051 1 5.328 1c.399 0 .725.006.969.014.243-.009.57-.014.968-.014 1.277 0 2.316.454 3.011 1.229.649.738.822 1.689.822 2.558 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095v1.918c-.13.835-3.44 3.749-7.998 3.749h-.002Zm3.394-4.543c-.315 0-.727.201-1.231.605-.168.134-.378.301-.625.498-.429.343-.893.605-1.535.605h-.002c-.643 0-1.107-.262-1.534-.605a23.71 23.71 0 0 0-.626-.498c-.504-.404-.916-.605-1.231-.605-.075 0-.09.058-.061.2.038.186.129.481.36.852.169.272.401.576.721.86.556.495 1.392.862 2.37.862h.003c.978 0 1.813-.367 2.369-.861.32-.285.552-.589.722-.861.23-.371.32-.666.36-.852.028-.142.013-.2-.062-.2ZM6.266 2.5c-.86 0-1.586.327-2.049.869-.49.573-.615 1.347-.615 2.118 0 .485.075.909.213 1.263l.087.233-.18.163a.717.717 0 0 0-.126.2 2.026 2.026 0 0 0-.112.443c-.022.147-.04.298-.063.46l-.009.062a5.2 5.2 0 0 0-.072.49l-.007.094.084.04c.407.196.724.492.96.762.293.334.532.711.705 1.12.172.406.262.852.106 1.237-.076.189-.217.38-.457.493A12.1 12.1 0 0 0 8 11.173c1.09 0 2.06-.165 2.869-.403-.24-.113-.382-.304-.458-.493-.156-.385-.066-.831.106-1.238a4.37 4.37 0 0 1 .705-1.12 3.81 3.81 0 0 1 .96-.76l.083-.04-.007-.095a5.14 5.14 0 0 0-.072-.49l-.01-.06c-.022-.163-.04-.314-.062-.461a2.03 2.03 0 0 0-.112-.444.717.717 0 0 0-.126-.199l-.18-.163.087-.233c.138-.354.213-.778.213-1.263 0-.771-.125-1.545-.615-2.118-.463-.542-1.189-.869-2.049-.869H7.265c-.219.005-.38.014-.498.014-.118 0-.28-.009-.5-.014Z" />
  </Svg>
);

const PiIcon = ({ size, color }: BrandIconProps) => (
  <Svg width={size} height={size} viewBox="0 0 32 32" fill={color}>
    <Path d="M16 2C8.268 2 2 8.268 2 16s6.268 14 14 14 14-6.268 14-14S23.732 2 16 2Zm5.6 21.6h-2.8V11.2h-5.6v12.4H10.4V11.2H8V8.4h16v2.8h-2.4v12.4Z" />
  </Svg>
);

const OmpIcon = ({ size }: BrandIconProps) => {
  const id = useId();
  const gradId = `omp-grad-${id}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#6366f1" />
          <Stop offset="100%" stopColor="#a855f7" />
        </LinearGradient>
      </Defs>
      <Rect width="32" height="32" rx="6" fill={`url(#${gradId})`} />
      <SvgText x="16" y="22" textAnchor="middle" fontSize="16" fontWeight="700" fill="white" fontFamily="system-ui, sans-serif">
        {'>'}_
      </SvgText>
    </Svg>
  );
};

const AiderIcon = ({ size, color }: BrandIconProps) => (
  <Svg width={size} height={size} viewBox="0 0 32 32" fill={color}>
    <Path d="M16 3L4 28h5l7-16 7 16h5L16 3Zm0 11l4 9h-8l4-9Z" />
  </Svg>
);

const KiloIcon = ({ size }: BrandIconProps) => (
  <Svg width={size} height={size} viewBox="0 0 32 32">
    <Rect width="32" height="32" rx="6" fill="#1a1a1a" />
    <SvgText x="16" y="22" textAnchor="middle" fontSize="18" fontWeight="800" fill="#facc15" fontFamily="system-ui, sans-serif">
      K
    </SvgText>
  </Svg>
);

const DroidIcon = ({ size }: BrandIconProps) => (
  <Svg width={size} height={size} viewBox="0 0 32 32">
    <Rect width="32" height="32" rx="6" fill="#1a1a1a" />
    <Path
      d="M12.5 10l-2 -3M19.5 10l2 -3M10 17h12v5a4 4 0 01-4 4h-4a4 4 0 01-4-4v-5ZM10 14a6 6 0 0112 0v3H10v-3ZM13 15.5a1 1 0 100-2 1 1 0 000 2ZM19 15.5a1 1 0 100-2 1 1 0 000 2Z"
      fill="none"
      stroke="white"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const GeminiIcon = ({ size, color }: BrandIconProps) => (
  <Svg width={size} height={size} viewBox="0 0 32 32" fill={color}>
    <Path d="M16 3c1.6 6.2 4.8 9.4 11 11-6.2 1.6-9.4 4.8-11 11-1.6-6.2-4.8-9.4-11-11 6.2-1.6 9.4-4.8 11-11Z" />
  </Svg>
);

const AntigravityIcon = ({ size, color }: BrandIconProps) => (
  <Svg width={size} height={size} viewBox="0 0 32 32" fill={color}>
    <Path d="M16 3L4 28h5l2.5-6h9l2.5 6h5L16 3zm0 9l3 7h-6l3-7z" />
  </Svg>
);

const BRAND_ICON_MAP: Record<string, (props: BrandIconProps) => JSX.Element> = {
  claude: ClaudeIcon,
  codex: CodexIcon,
  gemini: GeminiIcon,
  antigravity: AntigravityIcon,
  copilot: CopilotIcon,
  pi: PiIcon,
  omp: OmpIcon,
  aider: AiderIcon,
  kilo: KiloIcon,
  droid: DroidIcon,
};

export function AgentIcon({
  agentId,
  size = 16,
  allowRemote = true,
}: {
  agentId?: string;
  size?: number;
  allowRemote?: boolean;
}) {
  const { palette } = useTheme();

  if (!agentId) {
    return <AgentLetterIcon letter="?" size={size} />;
  }

  const BrandIcon = BRAND_ICON_MAP[agentId];
  if (BrandIcon) {
    return <BrandIcon size={size} color={palette.text} />;
  }

  const entry = getAgentEntry(agentId);
  const letter = (agentId.charAt(0) || '?').toUpperCase();
  if (allowRemote && entry?.faviconDomain) {
    return <AgentFaviconIcon domain={entry.faviconDomain} size={size} fallbackLetter={letter} />;
  }

  return <AgentLetterIcon letter={letter} size={size} />;
}
