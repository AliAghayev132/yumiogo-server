# controllers

## Məqsəd

Bu qovluq HTTP sorğularının biznes məntiqini icra edən request handler-ləri saxlayır. Hər controller faylı bir resurs üzrə əməliyyatları qruplaşdırır: `authController.js` qeydiyyat, OTP təsdiqi, login, token refresh, profil əməliyyatlarını; `postController.js` isə post-ların CRUD əməliyyatlarını idarə edir. Controller-lər `#models`, `#services`, `#utils`, `#config` və `#constants` modullarını birləşdirərək cavab qaytarır, route-lar isə yalnız bu handler-lərə bağlanır.

## Adlandırma / yazılış konvensiyası

Fayllar `<resurs>Controller.js` formatında adlandırılır (məs. `authController.js`, `postController.js`). Hər handler `asyncHandler` ilə sarınır və faylın sonunda adlandırılmış export kimi verilir. `index.js` barrel isə namespace export istifadə edir: `export * as authController from "./authController.js";`. Beləliklə çağırış yerində handler-lər `postController.createPost` kimi namespace altında qruplaşmış olur.

## Nümunə

`postController.js` faylından:

```js
const createPost = asyncHandler(async (req, res) => {
  const { title, content, excerpt, status, tags } = req.body;
  if (!title || !content) {
    return res.status(400).json({ success: false, message: "Title and content are required" });
  }
  const post = await Post.create({ title, content, excerpt, status, tags, author: req.user._id });
  res.status(201).json({ success: true, message: "Post created", data: { post } });
});
export { listPosts, getPost, createPost, updatePost, deletePost };
```

`index.js` bunu `export * as postController from "./postController.js";` ilə ixrac edir və route faylında belə istifadə olunur: `import { postController } from "#controllers";` → `router.post("/", postController.createPost)`.

## Yeni fayl necə əlavə olunur

1. `<resurs>Controller.js` faylı yarat (məs. `commentController.js`), handler-ləri `asyncHandler` ilə yaz və `export { createComment, ... }` ilə ixrac et.
2. `index.js` barrel-ə namespace export əlavə et: `export * as commentController from "./commentController.js";`.
3. Route faylında `#controllers` alias-ı ilə import et: `import { commentController } from "#controllers";`.
