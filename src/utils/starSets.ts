import { AppData, VocabularyCard, VocabularySet } from "../types";

// Danh sách "từ khó nhớ" được dựng lại từ chính cờ `starred` trên mỗi thẻ, chứ
// không phải là một danh sách rời được cập nhật song song. Lý do: gắn/bỏ sao
// xảy ra ở nhiều chỗ (trang chi tiết set, các chế độ học), và mỗi chỗ tự nhớ
// cập nhật thêm một danh sách riêng thì chỉ cần sót một chỗ là hai bên lệch
// nhau vĩnh viễn. Dựng lại từ nguồn thì không có trạng thái nào để lệch.

export const STAR_SET_SIZE = 20;
const STAR_SET_TITLE = /^star_(\d+)$/i;

/** star_01, star_02, ... */
export function starSetTitle(index: number): string {
  return `star_${String(index + 1).padStart(2, "0")}`;
}

export function isStarSet(set: Pick<VocabularySet, "title">): boolean {
  return STAR_SET_TITLE.test(set.title.trim());
}

/**
 * Id thẻ trong set sao suy ra từ id thẻ gốc, không sinh ngẫu nhiên.
 *
 * Mỗi lần đồng bộ là dựng lại toàn bộ set sao; nếu id sinh mới mỗi lần thì
 * tiến độ học của chính thẻ đó (đúng/sai, lần học gần nhất) sẽ mất sau mỗi
 * lần gắn sao cho một từ bất kỳ.
 */
const starCardId = (sourceCardId: string) => `star:${sourceCardId}`;
const sourceCardIdOf = (starredCardId: string) =>
  starredCardId.startsWith("star:") ? starredCardId.slice("star:".length) : null;

/**
 * Dựng lại các set sao từ toàn bộ thẻ đang được gắn sao.
 *
 * Gọi bên trong setData của useAppData nên mọi đường ghi dữ liệu đều đi qua
 * đây — không cần nhớ gọi thủ công ở từng nút bấm.
 */
export function syncStarSets(data: AppData): AppData {
  const sourceSets = data.sets.filter((set) => !isStarSet(set));
  const existingStarSets = data.sets.filter(isStarSet);

  // Bỏ sao ngay trong set sao thì phải gỡ sao ở THẺ GỐC. Nếu không, vòng dựng
  // lại ngay bên dưới sẽ đưa thẻ đó trở vào — người dùng bấm bỏ sao mà từ vẫn
  // nằm nguyên đấy.
  const unstarredInStarSet = new Set<string>();
  for (const set of existingStarSets) {
    for (const card of set.cards) {
      if (card.starred) continue;
      const sourceId = sourceCardIdOf(card.id);
      if (sourceId) unstarredInStarSet.add(sourceId);
    }
  }

  const normalisedSources: VocabularySet[] = unstarredInStarSet.size
    ? sourceSets.map((set) => ({
        ...set,
        cards: set.cards.map((card) =>
          unstarredInStarSet.has(card.id) && card.starred ? { ...card, starred: false } : card,
        ),
      }))
    : sourceSets;

  // Thứ tự duyệt cố định (theo thứ tự set rồi thứ tự thẻ) để một từ không nhảy
  // từ star_01 sang star_02 chỉ vì vừa gắn sao cho một từ khác.
  const starredCards: VocabularyCard[] = [];
  for (const set of normalisedSources) {
    for (const card of set.cards) {
      if (card.starred) starredCards.push(card);
    }
  }

  // Giữ lại tiến độ đã học của thẻ trong set sao qua mỗi lần dựng lại.
  const previousStarCards = new Map<string, VocabularyCard>();
  for (const set of existingStarSets) {
    for (const card of set.cards) previousStarCards.set(card.id, card);
  }

  const chunks: VocabularyCard[][] = [];
  for (let i = 0; i < starredCards.length; i += STAR_SET_SIZE) {
    chunks.push(starredCards.slice(i, i + STAR_SET_SIZE));
  }

  const now = new Date().toISOString();
  const nextStarSets: VocabularySet[] = chunks.map((chunk, index) => {
    // Dùng lại id của set sao cũ ở cùng vị trí: kết quả học (results) trỏ theo
    // setId, đổi id là mất sạch lịch sử của set đó.
    const previous = existingStarSets[index];
    return {
      id: previous?.id ?? `star-set-${index + 1}`,
      title: starSetTitle(index),
      description: "Các từ bạn đánh dấu là khó nhớ. Danh sách này tự cập nhật.",
      tags: ["star"],
      cards: chunk.map((card) => {
        const id = starCardId(card.id);
        const carried = previousStarCards.get(id);
        return {
          ...card,
          id,
          starred: true,
          // Nội dung từ luôn lấy theo bản gốc (sửa nghĩa ở set gốc thì set sao
          // cũng đúng theo), còn tiến độ thì giữ của chính set sao.
          status: carried?.status ?? card.status,
          mistakeCount: carried?.mistakeCount ?? 0,
          correctCount: carried?.correctCount ?? 0,
          lastStudiedAt: carried?.lastStudiedAt,
          nextReviewAt: carried?.nextReviewAt,
        };
      }),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      lastStudiedAt: previous?.lastStudiedAt,
    };
  });

  const removedStarSetIds = new Set(
    existingStarSets.slice(nextStarSets.length).map((set) => set.id),
  );

  return {
    ...data,
    sets: [...normalisedSources, ...nextStarSets],
    // Set sao đã biến mất (vì không còn đủ từ) thì lịch sử học của nó cũng đi
    // theo, nếu không phần thống kê sẽ tính điểm cho một set không tồn tại.
    results: removedStarSetIds.size
      ? data.results.filter((result) => result.mode === "listening" || !removedStarSetIds.has(result.setId))
      : data.results,
  };
}
