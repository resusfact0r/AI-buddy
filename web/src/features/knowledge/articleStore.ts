import { create } from 'zustand';

interface ArticleState {
  openId: string | null;
  open: (id: string) => void;
  close: () => void;
}

export const useArticle = create<ArticleState>()((set) => ({
  openId: null,
  open: (id) => set({ openId: id }),
  close: () => set({ openId: null }),
}));
