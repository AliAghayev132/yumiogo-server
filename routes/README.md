# routes/

## Məqsəd

Bu qovluq HTTP endpoint-lərini (URL + metod) müvafiq controller funksiyaları və middleware-lərlə əlaqələndirən Express router-larını saxlayır. Router-lar biznes məntiqi daşımır: onlar yalnız yönləndirmə (routing) təbəqəsidir — sorğu gəldikdə hansı middleware zəncirinin işləyəcəyini və hansı controller-in çağırılacağını təyin edir. Domen üzrə hər bir resurs (auth, post) öz ayrıca faylında qruplaşdırılır.

## Adlandırma / yazılış konvensiyası

Hər fayl `<entity>Routes.js` şəklində adlanır (məs. `authRoutes.js`, `postRoutes.js`). Fayl daxilində `Router()` factory-si ilə router yaradılır və `PascalCase` + `Router` suffiksi ilə (məs. `AuthRouter`, `PostRouter`) named export edilir. `Router` factory `#constants` barrel-indən import olunur. Bütün router-lar `index.js` barrel-ində yenidən export edilməlidir.

## Nümunə

`postRoutes.js` faylı `PostRouter`-i qurur:

```js
import { Router } from "#constants";
import { postController } from "#controllers";
import { authenticate, writeRateLimiter } from "#middlewares";

const PostRouter = Router();

PostRouter.get("/", postController.listPosts);
PostRouter.post("/", authenticate, writeRateLimiter, postController.createPost);

export { PostRouter };
```

`index.js` onu `export { PostRouter } from "./postRoutes.js";` sətri ilə açır. `app.js` isə `#routes` alias-ı vasitəsilə import edib mount edir: `app.use("/api/posts", PostRouter)`.

## Yeni fayl necə əlavə olunur

1. `<entity>Routes.js` faylı yarat (məs. `commentRoutes.js`).
2. `Router()` ilə router qur, endpoint-ləri controller və middleware-lərlə bağla, `CommentRouter` kimi export et.
3. `index.js`-ə `export { CommentRouter } from "./commentRoutes.js";` əlavə et.
4. `app.js`-də `#routes`-dan import edib `app.use("/api/comments", CommentRouter)` ilə mount et.
