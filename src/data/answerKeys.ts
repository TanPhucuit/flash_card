/**
 * Bang dap an da duoc kiem chung bang mat, khong phai do OCR sinh ra.
 *
 * OCR khong doc noi cac trang dap an cuoi sach: bang in nhieu cot, so thu tu
 * nho va mo tren nen xam nen bo do chu bo sot han cac so "7.", "8."... Do tren
 * trang that chi ghep dung 34.6% cap (so cau -> dap an). Mot dap an sai con te
 * hon o trong vi no cham sai bai nguoi hoc, nen phan nay duoc chep tay va doi
 * chieu doc lap (khop 78/78 tren trang kiem chung).
 *
 * File nay sinh ra tu answer_keys/*.tsv cua cong cu OCR - sua o do roi sinh
 * lai, dung sua tay o day.
 */
export interface VerifiedPassageKey {
  /** "Day 1", "Test 2"... dung nhu in trong sach. */
  group: string;
  /** Ten bai doc, dung de do trong tieu de/noi dung bai da tach duoc. */
  passage: string;
  /** So cau (hoac nhan nhu "Section A") -> dap an. */
  answers: Record<string, string>;
}

export interface VerifiedBookKey {
  /** Khop long voi ten sach nguoi dung nhap khi import. */
  bookMatch: RegExp;
  title: string;
  passages: VerifiedPassageKey[];
}

const FIFTEEN_DAYS: VerifiedPassageKey[] = [
  { group: "Day 1", passage: "Lessons from the Titanic", answers: { "1": "vi", "2": "iii", "3": "vii", "4": "i", "5": "ix", "6": "Eight distress rockets", "7": "at full capacity", "8": "international agreements/new regulations", "9": "sixteen watertight compartments", "10": "previous forty years", "11": "YES", "12": "NO", "13": "NOT GIVEN", "14": "NO", "15": "NOT GIVEN", "16": "YES", "17": "YES", "18": "ocean", "19": "safety", "20": "record", "21": "size", "22": "confident", "23": "water", "24": "float", "25": "inadequate", "26": "procedures", "27": "Ice warnings/Wireless messages", "28": "Outdated/Out of date", "29": "Yes", "30": "Doesn't say", "31": "buckle", "32": "Yes", "33": "24-hour", "34": "Yes", "35": "Standard operating procedures", "36": "Doesn't say", "37": "F", "38": "H", "39": "E", "40": "C" } },
  { group: "Day 2", passage: "Signs of Success", answers: { "1": "E", "2": "B", "3": "G", "4": "D", "5": "F", "6": "C" } },
  { group: "Day 2", passage: "A Stubborn, Taxing Problem", answers: { "1": "G", "2": "A", "3": "F", "4": "D", "5": "E" } },
  { group: "Day 2", passage: "Tea Times", answers: { "1": "iv", "2": "viii", "3": "i", "4": "x", "5": "ii", "6": "xii", "7": "v", "8": "iii", "9": "(rituals of) hospitality", "10": "grade(s) and blend(s)", "11": "contains caffeine", "12": "nomadic Bedouin", "13": "sugar and spices", "14": "(lingering) convention" } },
  { group: "Day 2", passage: "Mary Wollstonecraft", answers: { "1": "viii", "2": "ix", "3": "iii", "4": "iv", "5": "i", "6": "vii", "7": "D", "8": "A", "9": "D", "10": "B", "11": "B", "12": "C", "13": "B" } },
  { group: "Day 2", passage: "Glass", answers: { "1": "C", "2": "A", "3": "C", "4": "A", "5": "D", "6": "C" } },
  { group: "Day 3", passage: "From Black Box to Blue Box", answers: { "1": "B", "2": "F", "3": "C", "4": "A", "5": "I", "6": "G" } },
  { group: "Day 3", passage: "Fat of the Land", answers: { "1": "K", "2": "A", "3": "F", "4": "G", "5": "H", "6": "I" } },
  { group: "Day 3", passage: "A Modest Undertaking", answers: { "1": "F", "2": "C", "3": "E", "4": "D", "5": "L", "6": "A" } },
  { group: "Day 3", passage: "Leisure Time", answers: { "1": "iii", "2": "i", "3": "iv", "4": "xiii", "5": "xi", "6": "vii", "7": "xiv", "8": "NO", "9": "YES", "10": "NO", "11": "NOT GIVEN", "12": "NOT GIVEN" } },
  { group: "Day 3", passage: "The History of Writing", answers: { "1": "E", "2": "F", "3": "B", "4": "G", "5": "C", "6": "D", "7": "H", "8": "Southwestern France", "9": "bartered objects", "10": "ideas/concepts", "11": "symbols", "12": "sound", "13": "C", "14": "D", "15": "C" } },
  { group: "Day 3", passage: "Historical Thermometers", answers: { "Section A": "underground temperature", "Section B": "temperature variation", "Section C": "measurable change", "Section D": "valuable check", "Section E": "fill gaps", "Section F": "global network", "Section G": "climate studies" } },
  { group: "Day 3", passage: "Parenting and Responsibility", answers: { "1": "C", "2": "B", "3": "A", "4": "F", "5": "E", "6": "D", "7": "DA", "8": "R", "9": "DA", "10": "EG", "11": "R", "12": "EG", "13": "VH", "14": "DA", "15": "W" } },
  { group: "Day 3", passage: "What Is a Dinosaur?", answers: { "1": "vi", "2": "xi", "3": "xiii", "4": "vii", "5": "iv", "6": "v", "7": "viii", "8": "skeletal anatomy", "9": "eosuchians", "10": "two long bones", "11": "B", "12": "G", "13": "H", "14": "F" } },
  { group: "Day 3", passage: "Hair Today", answers: { "1": "B", "2": "F", "3": "A", "4": "E", "5": "K", "6": "G", "7": "L", "8": "H" } },
  { group: "Day 4", passage: "The 5,000-mile National Cycle Network", answers: { "1": "Several hundred miles", "2": "Road danger", "3": "Slower traffic systems", "4": "Make a donation", "5": "Walkers" } },
  { group: "Day 4", passage: "Environmental Impact of Mining on People", answers: { "1": "Remote places", "2": "Forest", "3": "Ore processing plants", "4": "Solid sediment", "5": "Mine tailings/fumes (gas)" } },
  { group: "Day 4", passage: "Where Are the Jobs?", answers: { "1": "job creation/job growth", "2": "Big bets", "3": "information technology/IT", "4": "loftier prices", "5": "generate", "6": "customised chips", "7": "surging job creation", "8": "jobless recovery", "9": "innovation economy" } },
  { group: "Day 4", passage: "The Blueberries of Mars", answers: { "1": "optical illusions", "2": "Opportunity's primary mission", "3": "Mars' surface formations", "4": "presence of water", "5": "Minerals", "6": "temperature and atmosphere", "7": "seeped up", "8": "selected rocks" } },
  { group: "Day 4", passage: "Another Intelligence?", answers: { "1": "C", "2": "I", "3": "E", "4": "H", "5": "F", "6": "C", "7": "C", "8": "C", "9": "D", "10": "B", "11": "A", "12": "C", "13": "NOT GIVEN" } }
];

export const VERIFIED_ANSWER_KEYS: VerifiedBookKey[] = [
  {
    bookMatch: /15\s*days|15_day/i,
    title: "15 Days Practice for IELTS Reading",
    passages: FIFTEEN_DAYS,
  },
];
