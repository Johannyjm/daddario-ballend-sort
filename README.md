# Hue Order

6色を直感で並べる軽量パズルです。

https://hue-order.vercel.app/

## Local

```sh
npm install
npm run dev
```

本番ビルドの確認:

```sh
npm run build
npm run preview
```

## Color Order

公式のギター弦ボールエンド色に合わせ、6弦から1弦を次の順にしています。

| String | Note | Color | UI hex |
| --- | --- | --- | --- |
| 6th | E | Gold | `#c99a2e` |
| 5th | A | Red | `#d71920` |
| 4th | D | Black | `#151515` |
| 3rd | G | Green | `#18894f` |
| 2nd | B | Purple | `#6f3da8` |
| 1st | E | Silver | `#c9ced3` |

Gold と Silver は単色ではなく、CSS gradient で金属感を出しています。

## Global Stats On Vercel

フロントエンドは `/api/stats` を優先し、APIが使えない環境では `localStorage` へフォールバックします。
ローカルホストではAPI呼び出しを抑制します。ローカルでAPIまで試す場合は `VITE_STATS_API=1` を付けて起動します。

統計にはプレイ数、完全正解数、平均ヒット本数、弦ごとの正解率を保存します。
Viteのローカル開発サーバーでは端末ごとの `localStorage` 統計を使い、Vercelデプロイ後はUpstash Redisで全体統計を永続化します。

Vercelで全世界向けの統計にする場合は、MarketplaceのRedis/Upstash連携で次の環境変数を設定します。

```sh
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

Upstash Vercel Integration が `UPSTASH_REDIS_KV_REST_API_URL` と
`UPSTASH_REDIS_KV_REST_API_TOKEN` を作成した場合も、そのまま読めます。
既存のVercel KV環境向けに `KV_REST_API_URL` と `KV_REST_API_TOKEN` も読めます。
