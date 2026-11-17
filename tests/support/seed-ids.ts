// ID cố định trong supabase/seed.sql
const id = (n: string) => `aaaaaaaa-0000-4000-8000-000000000${n}`;

export const SEED = {
  owner: { id: id('901'), email: 'owner@laodai.test', password: 'laodai-owner-123' },
  menus: { xoi: id('101'), com: id('102') },
  points: { xoiA: id('201'), xoiB: id('202'), com: id('203') },
  tablets: { A: id('301'), B: id('302') },
  staff: { Lan: id('401'), Mai: id('402'), Hung: id('403') },
  products: { xoiGa: id('501'), xoiXeo: id('502'), xoiPate: id('503'), xoiTc: id('504'), comGa: id('511'), comDui: id('512') },
  toppings: { trung: id('601'), cha: id('602'), ruoc: id('603'), canh: id('611'), dua: id('612'), themCom: id('613'), themGa: id('614') },
  combos: { xoiGaTrung: id('701'), xoiXeoChaRuoc: id('702'), comGaCanh: id('711') },
  customers: { dungGv: id('801'), dungPhuongB: id('802') },
  prices: {
    xoiGa: 25000, xoiXeo: 15000, xoiPate: 20000, xoiTc: 30000, comGa: 35000, comDui: 45000,
    trung: 6000, cha: 8000, ruoc: 5000, canh: 5000, dua: 3000, themCom: 5000, themGa: 15000,
  },
} as const;
