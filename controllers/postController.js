// Models
import { Post } from "#models";

// Utils
import { asyncHandler } from "#utils";

/**
 * List published posts (public) with pagination + optional filters.
 * GET /api/posts?page=1&limit=10&tag=news&search=hello
 */
const listPosts = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const skip = (page - 1) * limit;

  // Base filter: only published, non-deleted posts.
  const filter = { status: "published", isDeleted: false };

  // Optional filter demos.
  if (req.query.tag) filter.tags = req.query.tag;
  if (req.query.search) {
    filter.title = { $regex: String(req.query.search), $options: "i" };
  }

  const [posts, total] = await Promise.all([
    Post.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("author", "firstName lastName avatar"),
    Post.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      posts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

/**
 * Get a single post and increment its view counter.
 * GET /api/posts/:id
 */
const getPost = asyncHandler(async (req, res) => {
  const post = await Post.findOne({
    _id: req.params.id,
    isDeleted: false,
  }).populate("author", "firstName lastName avatar");

  if (!post) {
    return res.status(404).json({ success: false, message: "Post not found" });
  }

  // Instance method demo.
  await post.incrementViews();

  res.json({ success: true, data: { post } });
});

/**
 * Create a post (author = current user).
 * POST /api/posts
 */
const createPost = asyncHandler(async (req, res) => {
  const { title, content, excerpt, status, tags } = req.body;

  if (!title || !content) {
    return res.status(400).json({
      success: false,
      message: "Title and content are required",
    });
  }

  const post = await Post.create({
    title,
    content,
    excerpt,
    status,
    tags,
    author: req.user._id,
  });

  res.status(201).json({
    success: true,
    message: "Post created",
    data: { post },
  });
});

/**
 * Update a post (owner only).
 * PUT /api/posts/:id
 */
const updatePost = asyncHandler(async (req, res) => {
  const post = await Post.findOne({ _id: req.params.id, isDeleted: false });

  if (!post) {
    return res.status(404).json({ success: false, message: "Post not found" });
  }

  // Ownership check (admins may edit any post).
  if (post.author.toString() !== req.user._id.toString() && req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "You do not have permission to edit this post",
    });
  }

  const { title, content, excerpt, status, tags } = req.body;
  if (title !== undefined) post.title = title;
  if (content !== undefined) post.content = content;
  if (excerpt !== undefined) post.excerpt = excerpt;
  if (status !== undefined) post.status = status;
  if (tags !== undefined) post.tags = tags;

  await post.save();

  res.json({ success: true, message: "Post updated", data: { post } });
});

/**
 * Soft-delete a post (owner only).
 * DELETE /api/posts/:id
 */
const deletePost = asyncHandler(async (req, res) => {
  const post = await Post.findOne({ _id: req.params.id, isDeleted: false });

  if (!post) {
    return res.status(404).json({ success: false, message: "Post not found" });
  }

  if (post.author.toString() !== req.user._id.toString() && req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "You do not have permission to delete this post",
    });
  }

  post.isDeleted = true;
  await post.save();

  res.json({ success: true, message: "Post deleted" });
});

export { listPosts, getPost, createPost, updatePost, deletePost };
