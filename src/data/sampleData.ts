import { AppData, VocabularyCard, VocabularySet } from "../types";

const now = new Date().toISOString();

const card = (
  word: string,
  ipa: string,
  meaningVi: string,
  definitionEn: string,
  exampleEn: string,
  exampleVi: string,
  partOfSpeech = "noun",
  level = "A2",
): VocabularyCard => ({
  id: crypto.randomUUID(),
  word,
  ipa,
  meaningVi,
  definitionEn,
  exampleEn,
  exampleVi,
  partOfSpeech,
  level,
  synonyms: [],
  antonyms: [],
  status: "new",
  mistakeCount: 0,
  correctCount: 0,
  starred: false,
});

export const sampleSet: VocabularySet = {
  id: "sample-toeic-unit-1",
  title: "TOEIC Unit 1 - Business Vocabulary",
  description: "Bộ từ vựng mẫu về môi trường kinh doanh, phù hợp để thử các chế độ học local.",
  tags: ["TOEIC", "Business", "Unit 1"],
  createdAt: now,
  updatedAt: now,
  cards: [
    card("abandon", "/əˈbændən/", "từ bỏ", "to leave something permanently", "The company had to abandon the old plan.", "Công ty phải từ bỏ kế hoạch cũ.", "verb", "B1"),
    card("benefit", "/ˈbenɪfɪt/", "lợi ích", "an advantage or helpful result", "The new policy offers many benefits.", "Chính sách mới mang lại nhiều lợi ích."),
    card("customer", "/ˈkʌstəmər/", "khách hàng", "a person who buys goods or services", "The customer asked for a refund.", "Khách hàng yêu cầu hoàn tiền."),
    card("invoice", "/ˈɪnvɔɪs/", "hóa đơn", "a document listing goods or services and the amount to pay", "Please send the invoice by email.", "Vui lòng gửi hóa đơn qua email."),
    card("purchase", "/ˈpɜːrtʃəs/", "mua hàng", "to buy something", "We need approval before making a purchase.", "Chúng ta cần phê duyệt trước khi mua hàng.", "verb"),
    card("meeting", "/ˈmiːtɪŋ/", "cuộc họp", "an event where people discuss something", "The meeting starts at nine.", "Cuộc họp bắt đầu lúc chín giờ."),
    card("schedule", "/ˈskedʒuːl/", "lịch trình", "a plan of times for activities", "The delivery schedule has changed.", "Lịch giao hàng đã thay đổi."),
    card("employee", "/ɪmˈplɔɪiː/", "nhân viên", "a person who works for a company", "Every employee received training.", "Mỗi nhân viên đều được đào tạo."),
    card("contract", "/ˈkɑːntrækt/", "hợp đồng", "a legal agreement", "They signed the contract yesterday.", "Họ đã ký hợp đồng hôm qua."),
    card("delivery", "/dɪˈlɪvəri/", "giao hàng", "the act of bringing goods to a place", "Free delivery is available today.", "Hôm nay có giao hàng miễn phí."),
  ],
};

export const initialData: AppData = {
  sets: [sampleSet],
  results: [],
  matchBestTimes: {},
  settings: {
    theme: "light",
    voiceURI: "",
  },
};
