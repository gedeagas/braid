// ~180 Asian cities across Japan, Korea, China, and Indonesia for random branch naming
const ASIAN_CITIES = [
  // Japan
  'tokyo', 'osaka', 'kyoto', 'nagoya', 'sapporo', 'fukuoka', 'kobe', 'yokohama',
  'sendai', 'hiroshima', 'nara', 'kamakura', 'kanazawa', 'nikko', 'hakodate',
  'nagasaki', 'kumamoto', 'kagoshima', 'okayama', 'matsumoto', 'takayama',
  'miyajima', 'beppu', 'shirakawa', 'onomichi', 'naoshima', 'hakone', 'atami',
  'karuizawa', 'furano', 'otaru', 'noboribetsu', 'aomori', 'akita', 'morioka',
  'matsuyama', 'takamatsu', 'tokushima', 'kochi', 'sasebo', 'shimizu', 'enoshima',
  'ise', 'tottori', 'izumo', 'himeji', 'uji', 'arashiyama', 'shibuya', 'shinjuku',
  // Korea
  'seoul', 'busan', 'incheon', 'daegu', 'daejeon', 'gwangju', 'ulsan', 'suwon',
  'jeju', 'jeonju', 'gyeongju', 'sokcho', 'gangneung', 'andong', 'tongyeong',
  'yeosu', 'mokpo', 'chuncheon', 'wonju', 'pohang', 'gimhae', 'changwon',
  'jinju', 'gumi', 'iksan', 'gunsan', 'naju', 'boryeong', 'danyang', 'hadong',
  'namhae', 'geoje', 'yangyang', 'pyeongchang', 'jecheon', 'samcheok', 'taebaek',
  'mungyeong', 'yeongju', 'gimpo',
  // China
  'beijing', 'shanghai', 'guangzhou', 'shenzhen', 'chengdu', 'hangzhou', 'wuhan',
  'xian', 'nanjing', 'suzhou', 'chongqing', 'tianjin', 'qingdao', 'dalian',
  'xiamen', 'kunming', 'guilin', 'harbin', 'changsha', 'zhengzhou', 'fuzhou',
  'hefei', 'guiyang', 'lanzhou', 'lhasa', 'lijiang', 'dali', 'luoyang', 'dunhuang',
  'pingyao', 'wuxi', 'zhuhai', 'sanya', 'huangshan', 'emeishan', 'zhangjiajie',
  'yangshuo', 'wuyishan', 'quanzhou', 'shaoxing', 'wenzhou', 'nanning', 'hohhot',
  'urumqi', 'yinchuan', 'xining', 'jinan', 'taiyuan', 'luzhou', 'kaifeng',
  // Indonesia
  'jakarta', 'surabaya', 'bandung', 'medan', 'semarang', 'makassar', 'palembang',
  'tangerang', 'denpasar', 'yogyakarta', 'malang', 'solo', 'manado', 'padang',
  'banjarmasin', 'pontianak', 'balikpapan', 'mataram', 'kupang', 'ambon',
  'jayapura', 'ternate', 'kendari', 'palu', 'bengkulu', 'jambi', 'lampung',
  'cirebon', 'bogor', 'bekasi', 'depok', 'ubud', 'sanur', 'lovina', 'labuan',
  'bajo', 'bukittinggi', 'toba', 'pangandaran', 'karimunjawa',
]

const SUFFIX_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Generate a random branch name: city + 2-char alphanumeric suffix (~233k unique combos) */
export function randomBranchName(): string {
  const arr = new Uint32Array(3)
  crypto.getRandomValues(arr)
  const city = ASIAN_CITIES[arr[0] % ASIAN_CITIES.length]
  const s1 = SUFFIX_CHARS[arr[1] % SUFFIX_CHARS.length]
  const s2 = SUFFIX_CHARS[arr[2] % SUFFIX_CHARS.length]
  return `${city}-${s1}${s2}`
}
