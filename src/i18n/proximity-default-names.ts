import type { Language } from './index';

const PROXIMITY_DEFAULT_NAME_ADJECTIVES = [
  'Amber',
  'Brave',
  'Bright',
  'Calm',
  'Clever',
  'Cozy',
  'Daring',
  'Eager',
  'Fair',
  'Fast',
  'Gentle',
  'Golden',
  'Happy',
  'Jolly',
  'Kind',
  'Lively',
  'Lucky',
  'Merry',
  'Misty',
  'Noble',
  'Proud',
  'Quiet',
  'Rapid',
  'Ready',
  'Shiny',
  'Silent',
  'Smart',
  'Sunny',
  'Swift',
  'Tidy',
  'Warm',
  'Wise',
] as const;

const PROXIMITY_DEFAULT_NAME_ANIMALS = [
  'Badger',
  'Bear',
  'Beaver',
  'Bison',
  'Cat',
  'Crane',
  'Deer',
  'Dolphin',
  'Eagle',
  'Falcon',
  'Fox',
  'Gecko',
  'Hare',
  'Heron',
  'Koala',
  'Lark',
  'Lynx',
  'Manta',
  'Mole',
  'Otter',
  'Owl',
  'Panda',
  'Robin',
  'Seal',
  'Sparrow',
  'Swan',
  'Tiger',
  'Turtle',
  'Whale',
  'Wolf',
  'Wren',
  'Yak',
] as const;

export type ProximityNameVocabulary = {
  readonly adjectives: readonly string[];
  readonly animals: readonly string[];
  readonly order: 'adjective-first' | 'animal-first';
  readonly separator: string;
};

function vocabulary(
  adjectives: readonly string[],
  animals: readonly string[],
  order: ProximityNameVocabulary['order'] = 'adjective-first',
  separator = ' ',
): ProximityNameVocabulary {
  return { adjectives, animals, order, separator };
}

/**
 * Each catalog has 32 × 32 combinations. These are native-language aliases,
 * not word-for-word translations. Inflected catalogs use masculine singular
 * animal nouns and matching adjectives; Japanese and Korean modifiers include
 * their linking forms. Persian ezafe is left implicit in ordinary spelling.
 */
export const PROXIMITY_DEFAULT_NAMES: Record<Language, ProximityNameVocabulary> = {
  en: {
    adjectives: PROXIMITY_DEFAULT_NAME_ADJECTIVES,
    animals: PROXIMITY_DEFAULT_NAME_ANIMALS,
    order: 'adjective-first',
    separator: ' ',
  },
  zh: vocabulary(
    [
      '快乐', '勇敢', '聪明', '温柔', '安静', '活泼', '幸运', '好奇',
      '悠闲', '机灵', '友善', '阳光', '自由', '灵巧', '沉稳', '热心',
      '勤快', '可爱', '开心', '乐观', '自在', '顽皮', '害羞', '认真',
      '爱笑', '爱玩', '爱睡', '迷糊', '腼腆', '暖心', '潇洒', '呆萌',
    ],
    [
      '小猫', '小狗', '狐狸', '熊猫', '海豚', '松鼠', '兔子', '小熊',
      '企鹅', '海獭', '考拉', '小鹿', '老虎', '狮子', '鲸鱼', '海豹',
      '天鹅', '麻雀', '喜鹊', '白鹭', '海鸥', '鹦鹉', '乌龟', '壁虎',
      '刺猬', '浣熊', '河狸', '水獭', '树懒', '小羊', '小马', '小象',
    ],
    'adjective-first', '的',
  ),
  'zh-Hant': vocabulary(
    [
      '快樂', '勇敢', '聰明', '溫柔', '安靜', '活潑', '幸運', '好奇',
      '悠閒', '機靈', '友善', '陽光', '自由', '靈巧', '沉穩', '熱心',
      '勤快', '可愛', '開心', '樂觀', '自在', '頑皮', '害羞', '認真',
      '愛笑', '愛玩', '愛睡', '迷糊', '靦腆', '暖心', '瀟灑', '呆萌',
    ],
    [
      '小貓', '小狗', '狐狸', '貓熊', '海豚', '松鼠', '兔子', '小熊',
      '企鵝', '海獺', '無尾熊', '小鹿', '老虎', '獅子', '鯨魚', '海豹',
      '天鵝', '麻雀', '喜鵲', '白鷺', '海鷗', '鸚鵡', '烏龜', '壁虎',
      '刺蝟', '浣熊', '河狸', '水獺', '樹懶', '小羊', '小馬', '小象',
    ],
    'adjective-first', '的',
  ),
  ja: vocabulary(
    [
      '陽気な', '勇敢な', '賢い', '優しい', '静かな', '元気な', '幸運な', '好奇心旺盛な',
      'のんびりした', '賑やかな', '親切な', '明るい', '自由な', 'すばしっこい', '穏やかな', '素直な',
      '働き者の', 'かわいい', '愉快な', '前向きな', '気ままな', 'いたずら好きな', '恥ずかしがりの', '真面目な',
      '笑顔の', '遊び好きな', '眠そうな', 'おっとりした', '照れ屋の', '心優しい', '爽やかな', '夢見る',
    ],
    [
      'ネコ', 'イヌ', 'キツネ', 'パンダ', 'イルカ', 'リス', 'ウサギ', 'クマ',
      'ペンギン', 'ラッコ', 'コアラ', 'シカ', 'トラ', 'ライオン', 'クジラ', 'アザラシ',
      'ハクチョウ', 'スズメ', 'カササギ', 'サギ', 'カモメ', 'オウム', 'カメ', 'ヤモリ',
      'ハリネズミ', 'アライグマ', 'ビーバー', 'カワウソ', 'ナマケモノ', 'ヒツジ', 'ウマ', 'ゾウ',
    ],
    'adjective-first', '',
  ),
  ko: vocabulary(
    [
      '행복한', '용감한', '똑똑한', '다정한', '조용한', '활기찬', '운 좋은', '호기심 많은',
      '느긋한', '재빠른', '친절한', '밝은', '자유로운', '날쌘', '차분한', '솔직한',
      '부지런한', '귀여운', '유쾌한', '긍정적인', '태평한', '장난꾸러기', '수줍은', '성실한',
      '웃는', '놀기 좋아하는', '졸린', '온화한', '낯가리는', '마음씨 고운', '멋진', '꿈꾸는',
    ],
    [
      '고양이', '강아지', '여우', '판다', '돌고래', '다람쥐', '토끼', '곰',
      '펭귄', '해달', '코알라', '사슴', '호랑이', '사자', '고래', '물범',
      '백조', '참새', '까치', '백로', '갈매기', '앵무새', '거북이', '도마뱀',
      '고슴도치', '너구리', '비버', '수달', '나무늘보', '양', '말', '코끼리',
    ],
  ),
  de: vocabulary(
    [
      'Fröhlicher', 'Mutiger', 'Kluger', 'Sanfter', 'Ruhiger', 'Lebhafter', 'Glücklicher', 'Neugieriger',
      'Gemütlicher', 'Flinker', 'Freundlicher', 'Heiterer', 'Freier', 'Wendiger', 'Gelassener', 'Ehrlicher',
      'Fleißiger', 'Niedlicher', 'Lustiger', 'Zuversichtlicher', 'Entspannter', 'Verspielter', 'Schüchterner', 'Sorgfältiger',
      'Lächelnder', 'Wachsamer', 'Schläfriger', 'Friedlicher', 'Leiser', 'Herzlicher', 'Kühner', 'Weiser',
    ],
    [
      'Dachs', 'Bär', 'Biber', 'Bison', 'Kater', 'Kranich', 'Hirsch', 'Delfin',
      'Adler', 'Falke', 'Fuchs', 'Gecko', 'Hase', 'Reiher', 'Koala', 'Löwe',
      'Luchs', 'Rochen', 'Maulwurf', 'Otter', 'Uhu', 'Panda', 'Pinguin', 'Seehund',
      'Spatz', 'Schwan', 'Tiger', 'Igel', 'Wal', 'Wolf', 'Zaunkönig', 'Yak',
    ],
  ),
  es: vocabulary(
    [
      'alegre', 'valiente', 'listo', 'amable', 'tranquilo', 'vivaz', 'afortunado', 'curioso',
      'relajado', 'veloz', 'amistoso', 'risueño', 'libre', 'ágil', 'sereno', 'sincero',
      'trabajador', 'tierno', 'divertido', 'optimista', 'soñador', 'juguetón', 'tímido', 'atento',
      'sonriente', 'vigilante', 'dormilón', 'pacífico', 'silencioso', 'cariñoso', 'audaz', 'sabio',
    ],
    [
      'Tejón', 'Oso', 'Castor', 'Bisonte', 'Gato', 'Perro', 'Ciervo', 'Delfín',
      'Halcón', 'Zorro', 'Geco', 'Conejo', 'Koala', 'León', 'Lince', 'Topo',
      'Búho', 'Panda', 'Pingüino', 'Gorrión', 'Cisne', 'Tigre', 'Erizo', 'Lobo',
      'Yak', 'Caballo', 'Elefante', 'Mapache', 'Camello', 'Canguro', 'Loro', 'Pulpo',
    ],
    'animal-first',
  ),
  fr: vocabulary(
    [
      'joyeux', 'courageux', 'malin', 'aimable', 'calme', 'vif', 'chanceux', 'curieux',
      'détendu', 'rapide', 'amical', 'souriant', 'libre', 'agile', 'serein', 'sincère',
      'travailleur', 'tendre', 'amusant', 'optimiste', 'rêveur', 'joueur', 'timide', 'attentif',
      'patient', 'vigilant', 'endormi', 'paisible', 'silencieux', 'affectueux', 'audacieux', 'sage',
    ],
    [
      'Blaireau', 'Ours', 'Castor', 'Bison', 'Chat', 'Chien', 'Cerf', 'Dauphin',
      'Aigle', 'Faucon', 'Renard', 'Gecko', 'Lièvre', 'Héron', 'Koala', 'Lion',
      'Lynx', 'Panda', 'Hibou', 'Manchot', 'Moineau', 'Cygne', 'Tigre', 'Hérisson',
      'Loup', 'Yack', 'Cheval', 'Éléphant', 'Chameau', 'Kangourou', 'Perroquet', 'Lapin',
    ],
    'animal-first',
  ),
  it: vocabulary(
    [
      'allegro', 'coraggioso', 'furbo', 'gentile', 'tranquillo', 'vivace', 'fortunato', 'curioso',
      'rilassato', 'veloce', 'amichevole', 'sorridente', 'libero', 'agile', 'sereno', 'sincero',
      'operoso', 'tenero', 'divertente', 'ottimista', 'sognatore', 'giocherellone', 'timido', 'attento',
      'paziente', 'vigile', 'assonnato', 'pacifico', 'silenzioso', 'affettuoso', 'audace', 'saggio',
    ],
    [
      'Tasso', 'Orso', 'Castoro', 'Bisonte', 'Gatto', 'Cane', 'Cervo', 'Delfino',
      'Falco', 'Geco', 'Coniglio', 'Airone', 'Koala', 'Leone', 'Panda', 'Gufo',
      'Pinguino', 'Passero', 'Cigno', 'Tigre', 'Riccio', 'Lupo', 'Yak', 'Cavallo',
      'Elefante', 'Cammello', 'Canguro', 'Pappagallo', 'Polpo', 'Procione', 'Gabbiano', 'Pettirosso',
    ],
    'animal-first',
  ),
  'pt-BR': vocabulary(
    [
      'alegre', 'corajoso', 'esperto', 'gentil', 'tranquilo', 'animado', 'sortudo', 'curioso',
      'relaxado', 'veloz', 'amigável', 'risonho', 'livre', 'ágil', 'sereno', 'sincero',
      'trabalhador', 'fofo', 'divertido', 'otimista', 'sonhador', 'brincalhão', 'tímido', 'atento',
      'sorridente', 'vigilante', 'sonolento', 'pacífico', 'silencioso', 'carinhoso', 'audaz', 'sábio',
    ],
    [
      'Texugo', 'Urso', 'Castor', 'Bisão', 'Gato', 'Cachorro', 'Cervo', 'Golfinho',
      'Falcão', 'Geco', 'Coelho', 'Coala', 'Leão', 'Lince', 'Panda', 'Pinguim',
      'Pardal', 'Cisne', 'Tigre', 'Ouriço', 'Lobo', 'Iaque', 'Cavalo', 'Elefante',
      'Camelo', 'Canguru', 'Papagaio', 'Polvo', 'Guaxinim', 'Pelicano', 'Tucano', 'Esquilo',
    ],
    'animal-first',
  ),
  'pt-PT': vocabulary(
    [
      'alegre', 'corajoso', 'esperto', 'gentil', 'tranquilo', 'animado', 'sortudo', 'curioso',
      'descontraído', 'veloz', 'amigável', 'risonho', 'livre', 'ágil', 'sereno', 'sincero',
      'trabalhador', 'fofinho', 'divertido', 'otimista', 'sonhador', 'brincalhão', 'tímido', 'atento',
      'sorridente', 'vigilante', 'sonolento', 'pacífico', 'silencioso', 'carinhoso', 'audaz', 'sábio',
    ],
    [
      'Texugo', 'Urso', 'Castor', 'Bisonte', 'Gato', 'Cão', 'Veado', 'Golfinho',
      'Falcão', 'Geco', 'Coelho', 'Coala', 'Leão', 'Lince', 'Panda', 'Pinguim',
      'Pardal', 'Cisne', 'Tigre', 'Ouriço', 'Lobo', 'Iaque', 'Cavalo', 'Elefante',
      'Camelo', 'Canguru', 'Papagaio', 'Polvo', 'Guaxinim', 'Pelicano', 'Tucano', 'Esquilo',
    ],
    'animal-first',
  ),
  ru: vocabulary(
    [
      'Весёлый', 'Смелый', 'Умный', 'Добрый', 'Тихий', 'Бодрый', 'Удачливый', 'Любопытный',
      'Неспешный', 'Быстрый', 'Дружелюбный', 'Радостный', 'Вольный', 'Ловкий', 'Спокойный', 'Честный',
      'Трудолюбивый', 'Милый', 'Забавный', 'Счастливый', 'Мечтательный', 'Игривый', 'Застенчивый', 'Внимательный',
      'Улыбчивый', 'Зоркий', 'Сонный', 'Мирный', 'Бесшумный', 'Ласковый', 'Отважный', 'Мудрый',
    ],
    [
      'барсук', 'медведь', 'бобр', 'бизон', 'кот', 'пёс', 'олень', 'дельфин',
      'орёл', 'сокол', 'лис', 'геккон', 'заяц', 'коала', 'лев', 'барс',
      'крот', 'филин', 'пингвин', 'тюлень', 'воробей', 'лебедь', 'тигр', 'ёж',
      'кит', 'волк', 'як', 'конь', 'слон', 'енот', 'верблюд', 'попугай',
    ],
  ),
  pl: vocabulary(
    [
      'Wesoły', 'Odważny', 'Bystry', 'Łagodny', 'Cichy', 'Żwawy', 'Szczęśliwy', 'Ciekawski',
      'Spokojny', 'Szybki', 'Przyjazny', 'Radosny', 'Wolny', 'Zwinny', 'Pogodny', 'Szczery',
      'Pracowity', 'Uroczy', 'Zabawny', 'Dziarski', 'Rozmarzony', 'Figlarny', 'Nieśmiały', 'Uważny',
      'Uśmiechnięty', 'Czujny', 'Senny', 'Pokojowy', 'Dyskretny', 'Serdeczny', 'Śmiały', 'Mądry',
    ],
    [
      'borsuk', 'niedźwiedź', 'bóbr', 'bizon', 'kot', 'pies', 'jeleń', 'delfin',
      'orzeł', 'sokół', 'lis', 'gekon', 'zając', 'koala', 'lew', 'ryś',
      'kret', 'puchacz', 'pingwin', 'wróbel', 'łabędź', 'tygrys', 'jeż', 'wieloryb',
      'wilk', 'jak', 'koń', 'słoń', 'szop', 'wielbłąd', 'kangur', 'pelikan',
    ],
  ),
  hu: vocabulary(
    [
      'Vidám', 'Bátor', 'Okos', 'Szelíd', 'Csendes', 'Élénk', 'Szerencsés', 'Kíváncsi',
      'Ráérős', 'Gyors', 'Barátságos', 'Derűs', 'Szabad', 'Fürge', 'Nyugodt', 'Őszinte',
      'Szorgos', 'Kedves', 'Mókás', 'Bizakodó', 'Álmodozó', 'Játékos', 'Félénk', 'Figyelmes',
      'Mosolygós', 'Éber', 'Álmos', 'Békés', 'Halk', 'Szívélyes', 'Merész', 'Bölcs',
    ],
    [
      'borz', 'medve', 'hód', 'bölény', 'macska', 'kutya', 'szarvas', 'delfin',
      'sas', 'sólyom', 'róka', 'gekkó', 'nyúl', 'gém', 'koala', 'oroszlán',
      'hiúz', 'rája', 'vakond', 'vidra', 'bagoly', 'panda', 'pingvin', 'fóka',
      'veréb', 'hattyú', 'tigris', 'teknős', 'bálna', 'farkas', 'sün', 'jak',
    ],
  ),
  tr: vocabulary(
    [
      'Neşeli', 'Cesur', 'Zeki', 'Nazik', 'Sessiz', 'Canlı', 'Şanslı', 'Meraklı',
      'Rahat', 'Hızlı', 'Dost Canlısı', 'Güler Yüzlü', 'Özgür', 'Çevik', 'Sakin', 'Dürüst',
      'Çalışkan', 'Sevimli', 'Eğlenceli', 'İyimser', 'Hayalperest', 'Oyuncu', 'Utangaç', 'Dikkatli',
      'Gülümseyen', 'Uyanık', 'Uykulu', 'Barışçıl', 'Uysal', 'Cana Yakın', 'Atılgan', 'Bilge',
    ],
    [
      'Porsuk', 'Ayı', 'Kunduz', 'Bizon', 'Kedi', 'Köpek', 'Geyik', 'Yunus',
      'Kartal', 'Şahin', 'Tilki', 'Geko', 'Tavşan', 'Balıkçıl', 'Koala', 'Aslan',
      'Vaşak', 'Vatoz', 'Köstebek', 'Su Samuru', 'Baykuş', 'Panda', 'Penguen', 'Fok',
      'Serçe', 'Kuğu', 'Kaplan', 'Kaplumbağa', 'Balina', 'Kurt', 'Kirpi', 'Yak',
    ],
  ),
  ar: vocabulary(
    [
      'مرح', 'شجاع', 'ذكي', 'لطيف', 'هادئ', 'نشيط', 'محظوظ', 'فضولي',
      'مسترخٍ', 'سريع', 'ودود', 'بشوش', 'حر', 'رشيق', 'رزين', 'صادق',
      'مجتهد', 'ظريف', 'مضحك', 'متفائل', 'حالم', 'لعوب', 'خجول', 'منتبه',
      'مبتسم', 'يقظ', 'نعسان', 'مسالم', 'صامت', 'حنون', 'جريء', 'حكيم',
    ],
    [
      'قط', 'كلب', 'ثعلب', 'دب', 'أسد', 'نمر', 'فيل', 'حصان',
      'أرنب', 'غزال', 'دلفين', 'حوت', 'غراب', 'بطريق', 'ببغاء', 'عصفور',
      'نسر', 'صقر', 'هدهد', 'طاووس', 'سنجاب', 'قنفذ', 'قندس', 'راكون',
      'كنغر', 'جمل', 'كوالا', 'باندا', 'وعل', 'ياك', 'أخطبوط', 'نورس',
    ],
    'animal-first',
  ),
  fa: vocabulary(
    [
      'شاد', 'شجاع', 'باهوش', 'مهربان', 'آرام', 'پرانرژی', 'خوش\u200cشانس', 'کنجکاو',
      'آسوده', 'سریع', 'خوش\u200cبرخورد', 'خندان', 'آزاد', 'چابک', 'متین', 'راستگو',
      'کوشا', 'ناز', 'بامزه', 'خوش\u200cبین', 'خیال\u200cپرداز', 'بازیگوش', 'خجالتی', 'دقیق',
      'خوش\u200cرو', 'هوشیار', 'خواب\u200cآلود', 'صلح\u200cجو', 'ساکت', 'صمیمی', 'دلیر', 'دانا',
    ],
    [
      'گربه', 'سگ', 'روباه', 'خرس', 'شیر', 'ببر', 'فیل', 'اسب',
      'خرگوش', 'گوزن', 'دلفین', 'نهنگ', 'فک', 'پنگوئن', 'طوطی', 'گنجشک',
      'عقاب', 'شاهین', 'هدهد', 'طاووس', 'سنجاب', 'جوجه\u200cتیغی', 'سگ آبی', 'راکون',
      'کانگورو', 'شتر', 'کوالا', 'پاندا', 'بز کوهی', 'یاک', 'سمور', 'قو',
    ],
    'animal-first',
  ),
  hi: vocabulary(
    [
      'खुश', 'बहादुर', 'चतुर', 'दयालु', 'शांत', 'फुर्तीला', 'भाग्यशाली', 'जिज्ञासु',
      'बेफिक्र', 'तेज़', 'मिलनसार', 'हँसमुख', 'आज़ाद', 'चुस्त', 'धीर', 'सच्चा',
      'मेहनती', 'प्यारा', 'मज़ेदार', 'आशावादी', 'सपनीला', 'चंचल', 'शर्मीला', 'सावधान',
      'हँसता', 'सतर्क', 'उनींदा', 'सरल', 'मौन', 'स्नेही', 'निडर', 'समझदार',
    ],
    [
      'बिल्ला', 'कुत्ता', 'भालू', 'शेर', 'बाघ', 'हाथी', 'घोड़ा', 'खरगोश',
      'हिरण', 'तेंदुआ', 'चीता', 'भेड़िया', 'सियार', 'ऊँट', 'कंगारू', 'पांडा',
      'कोआला', 'पेंगुइन', 'तोता', 'मोर', 'कबूतर', 'हंस', 'बाज़', 'उल्लू',
      'गरुड़', 'कछुआ', 'मेंढक', 'मगर', 'गैंडा', 'याक', 'बंदर', 'नेवला',
    ],
  ),
  th: vocabulary(
    [
      'ร่าเริง', 'กล้าหาญ', 'แสนรู้', 'ใจดี', 'เงียบขรึม', 'สดใส', 'โชคดี', 'ช่างสงสัย',
      'สบายใจ', 'ว่องไว', 'เป็นมิตร', 'ยิ้มแย้ม', 'รักอิสระ', 'คล่องแคล่ว', 'ใจเย็น', 'จริงใจ',
      'ขยัน', 'น่ารัก', 'อารมณ์ดี', 'มองโลกดี', 'ช่างฝัน', 'ขี้เล่น', 'ขี้อาย', 'รอบคอบ',
      'ช่างยิ้ม', 'ตื่นตัว', 'ขี้เซา', 'รักสงบ', 'เงียบสงบ', 'อบอุ่น', 'ใจกล้า', 'สุขุม',
    ],
    [
      'แมว', 'หมา', 'จิ้งจอก', 'หมี', 'สิงโต', 'เสือ', 'ช้าง', 'ม้า',
      'กระต่าย', 'กวาง', 'โลมา', 'วาฬ', 'แมวน้ำ', 'เพนกวิน', 'นกแก้ว', 'กระจอก',
      'อินทรี', 'เหยี่ยว', 'นกยูง', 'กระรอก', 'เม่น', 'บีเวอร์', 'แรคคูน', 'จิงโจ้',
      'อูฐ', 'โคอาลา', 'แพนด้า', 'จามรี', 'นาก', 'หงส์', 'เต่า', 'ตุ๊กแก',
    ],
    'animal-first', '',
  ),
};
