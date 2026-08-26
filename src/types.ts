export type DiscordUser = {
  id: string;
  username: string;
  tag: string;
  avatar: string;
};

export type ShopItem = {
  id: string;
  name: string;
  price: number;
  value: number;
  image: string;
  paypal: string;
  roblox: string;
  robuxPrice: number;
  sellerDiscordId: string;
  sellerName: string;
  sold: boolean;
  createdAt: number;
};

export type OrderItem = {
  id: string;
  name: string;
  price: number;
  robuxPrice: number;
  paypal: string;
  roblox: string;
  image: string;
};

export type Order = {
  invoice: string;
  buyerDiscordId: string;
  buyerUsername: string;
  method: "paypal" | "robux";
  hasPlus: boolean;
  status: "awaiting_payment" | "paid";
  totalEur: number;
  totalRobux: number;
  items: OrderItem[];
  createdAt: number;
  paidAt?: number;
  paymentNote?: string;
};
