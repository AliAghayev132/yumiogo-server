# models

## Məqsəd

Bu qovluq Mongoose modellərini — verilənlər bazasının sxemlərini və onlarla bağlı metodları — saxlayır. Hər model bir kolleksiyanı təsvir edir: `user.model.js` (istifadəçilər, rol/status), `otp.model.js` (TTL indeksli birdəfəlik kodlar və `createOTP`/`verifyOTP` static metodları), `post.model.js` (post-lar; virtual, compound index, static və instance metod, pre-save hook nümunələri ilə). Controller-lər və servislər bu modelləri import edərək məlumatı oxuyur və yazır.

## Adlandırma / yazılış konvensiyası

Fayllar `<entity>.model.js` formatında (kiçik hərflə) adlandırılır. Hər faylın sonunda model `export const Entity = Model("Entity", entitySchema);` şəklində PascalCase adlandırılmış export kimi verilir (`Model` `#constants`-dan gələn `mongoose.model` qısaltmasıdır). `index.js` barrel isə hər modeli fərdi olaraq re-export edir: `export { User } from "./user.model.js";`. Sxemlərdə enum dəyərləri `#constants`-dan (`userRoles`, `postStatus` və s.) götürülür. Qovluq başqa yerlərdə `#models` alias-ı ilə import olunur.

## Nümunə

`post.model.js` faylından:

```js
import { Schema, Model, postStatus } from "#constants";

const postSchema = new Schema(
  { title: { type: String, required: true, trim: true },
    status: { type: String, enum: postStatus, default: "draft" } },
  { timestamps: true, versionKey: false },
);
export const Post = Model("Post", postSchema);
```

`index.js` bunu `export { Post } from "./post.model.js";` ilə ixrac edir və controller-də belə istifadə olunur: `import { Post } from "#models";` → `const post = await Post.create({ ... });`.

## Yeni fayl necə əlavə olunur

1. `<entity>.model.js` faylı yarat (məs. `comment.model.js`), `new Schema({ ... })` təyin et və `export const Comment = Model("Comment", commentSchema);` ilə ixrac et.
2. `index.js` barrel-ə re-export əlavə et: `export { Comment } from "./comment.model.js";`.
3. İstifadə yerində `#models` alias-ı ilə import et: `import { Comment } from "#models";`.
