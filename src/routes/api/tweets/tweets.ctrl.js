const Joi = require("joi");
const { ObjectId } = require("mongoose").Types;
const twitter = require("twitter-text");
const Tweet = require("../../../models/Tweet");
const sha256 = require("../../../lib/sha256");

exports.checkTweet = async (ctx, next) => {
  const { id } = ctx.params;
  if (!ObjectId.isValid(id)) {
    ctx.status = 400;
    return null;
  }
  try {
    const tweet = await Tweet.findById(id);
    if (!tweet) {
      ctx.status = 404;
      return null;
    }
    ctx.state.tweet = tweet;
    return next();
  } catch (e) {
    throw (500, e);
  }
};

exports.writeTweet = async ctx => {
  const bodySchema = Joi.object({
    text: Joi.string()
      .required()
      .min(1)
      .max(1000),
    name: Joi.optional(),
    pass: Joi.optional()
  });
  const anonBodySchema = Joi.object({
    // anonymous: Joi.boolean().required(),
    name: Joi.string()
      .required()
      .min(1)
      .max(20),
    text: Joi.string()
      .required()
      .min(1)
      .max(1000),
    pass: Joi.string()
      .required()
      .min(6)
      .max(30)
  });
  // const { anonymous } = ctx.request.body;
  const { user } = ctx.state;
  const anonymous = !user;
  const schema = anonymous ? anonBodySchema : bodySchema;
  const validated = schema.validate(ctx.request.body);
  if (validated.error) {
    ctx.body = {
      msg: "잘못된 데이터입니다.",
      payload: validated.error
    };
    ctx.status = 400;
    return;
  }

  const { name, text, pass } = ctx.request.body;

  const hash = sha256(ctx.ip);
  const lastFive = hash.substr(hash.length - 5);

  const tags = twitter.extractHashtags(text);
  const uniqueTags = [...new Set(tags)];
  const tweet = new Tweet({
    text,
    writer: anonymous
      ? {
          name,
          anonymous: true,
          ipHash: lastFive,
          passwordHash: sha256(pass)
        }
      : {
          name: user.username,
          anonymous: false,
          ipHash: null,
          passwordHash: null
        },
    tags: uniqueTags
  });
  try {
    await tweet.save();
    ctx.body = tweet.serialize();
  } catch (e) {
    ctx.throw(500, e);
  }
};

exports.listTweets = async ctx => {
  const { cursor, recent, tag, username } = ctx.query;
  const isRecent = recent === "true";

  if (cursor && !ObjectId.isValid(cursor)) {
    ctx.status = 400;
    return;
  }

  const query = {};

  if (cursor) {
    query._id = isRecent ? { $gt: cursor } : { $lt: cursor };
  }

  if (tag) {
    query.tags = tag;
  }

  if (username) {
    query["writer.name"] = username;
    query["writer.anonymous"] = false;
  }

  try {
    const tweets = await Tweet.find(query)
      .sort({ _id: -1 })
      .limit(isRecent && cursor ? null : 10);
    ctx.body = tweets.map(t => t.serialize());
  } catch (e) {
    ctx.throw(500, e);
  }
};

exports.readTweet = async ctx => {
  ctx.body = ctx.state.tweet.serialize();
};
exports.removeTweet = async ctx => {
  const { pass } = ctx.query;
  const { tweet } = ctx.state;
  if (tweet.writer.anonymous) {
    if (!pass) {
      ctx.status = 400;
      ctx.body = {
        msg: "비밀번호를 입력하세요."
      };
      return;
    }
    const passwordHash = sha256(pass);
    if (passwordHash !== tweet.writer.passwordHash) {
      ctx.status = 403;
      return;
    }
    await tweet.remove();
    ctx.status = 204;
    return;
  }

  const { user } = ctx.state;
  if (user.username !== tweet.writer.name) {
    ctx.status = 401;
    return;
  }

  try {
    await tweet.remove();
    ctx.status = 204;
  } catch (e) {
    ctx.throw(500, e);
  }
};
