const express = require("express");

const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000");
    });
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

//API-1 POST - User Register API

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `SELECT *
    FROM user WHERE username = '${username}';
    `;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    const passwordLength = password.length;
    if (passwordLength < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      createUserQuery = `INSERT INTO 
            user (username, name, password, gender)
            VALUES(
                '${username}', '${name}', '${hashedPassword}', '${gender}'
            );
            `;
      await db.run(createUserQuery);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//API 2 POST - User Login API

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT *
    FROM user
    WHERE username = '${username}'
    `;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser !== undefined) {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "twitter");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

//Authentication JWT - Token

const authenticationToken = (request, response, next) => {
  let jwtToken;
  const authHeaders = request.headers["authorization"];
  if (authHeaders !== undefined) {
    jwtToken = authHeaders.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "twitter", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

//API 3 GET - Returns the latest tweets of people whom the user follows. Return 4 tweets at a time

const tweetResponse = (dbObject) => {
  return {
    username: dbObject.username,
    tweet: dbObject.tweet,
    dateTime: dbObject.date_time,
  };
};

app.get(
  "/user/tweets/feed/",
  authenticationToken,
  async (request, response) => {
    const selectUserTweets = `SELECT tweet.tweet_id, tweet.user_id, user.username, tweet.tweet, tweet.date_time
    FROM follower LEFT JOIN tweet
    ON tweet.user_id = follower.following_user_id
    LEFT JOIN user ON follower.following_user_id = user.user_id
    WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username = '${request.username}' )
    ORDER BY tweet.date_time DESC 
    LIMIT 4;
    `;
    const userTweets = await db.all(selectUserTweets);
    response.send(userTweets.map((item) => tweetResponse(item)));
  }
);

//API 4 GET - Returns the list of all names of people whom the user follows

app.get("/user/following/", authenticationToken, async (request, response) => {
  const { username } = request;

  const getUserFollowingPeoples = `SELECT user.name
    FROM follower LEFT JOIN user
    ON follower.following_user_id = user.user_id 
    WHERE follower.follower_user_id = (SELECT user.user_id FROM user WHERE username = '${username}' )
    `;
  const userFollowingPeople = await db.all(getUserFollowingPeoples);
  response.send(userFollowingPeople);
});

//API 5 GET - Returns the list of all names of people who follows the user

app.get("/user/followers/", authenticationToken, async (request, response) => {
  const { username } = request;
  const userFollowers = `SELECT user.name
    FROM follower LEFT JOIN user
    ON follower.follower_user_id = user.user_id
    WHERE follower.following_user_id = (SELECT user.user_id FROM user WHERE username = '${username}')
    `;
  const followers = await db.all(userFollowers);
  response.send(followers);
});

//API 6 GET

const follows = async (request, response, next) => {
  const { tweetId } = request.params;
  let isFollowing = `SELECT * FROM follower
    WHERE follower.follower_user_id = (SELECT user.user_id FROM user WHERE username = '${request.username}')
    and 
    follower.following_user_id = (SELECT user.user_id FROM user NATURAL JOIN tweet WHERE tweet.tweet_id = ${tweetId})
    `;
  const followingTweets = await db.get(isFollowing);
  if (followingTweets === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

app.get(
  "/tweets/:tweetId/",
  authenticationToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const { tweet, date_time } = await db.get(
      `SELECT tweet, date_time FROM tweet WHERE tweet_id = ${tweetId} `
    );
    const { likes } = await db.get(
      `SELECT COUNT(like_id) AS likes FROM like WHERE tweet_id = ${tweetId} `
    );
    const { replies } = await db.get(
      `SELECT COUNT(reply_id) AS replies FROM reply WHERE tweet_id = ${tweetId} `
    );
    response.send({ tweet, likes, replies, dateTime: date_time });
  }
);

//API 7 GET

app.get(
  "/tweets/:tweetId/likes/",
  authenticationToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikesQuery = `SELECT user.username 
    FROM like NATURAL JOIN user
    WHERE tweet_id = ${tweetId};
    `;
    const likes = await db.all(getLikesQuery);
    response.send({ likes: likes.map((item) => item.username) });
  }
);

//API 8 GET

app.get(
  "/tweets/:tweetId/replies/",
  authenticationToken,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const getRepliesCountQuery = `SELECT user.name, reply.reply
    FROM user NATURAL JOIN reply
    WHERE tweet_id = ${tweetId}
    `;
    const replies = await db.all(getRepliesCountQuery);
    response.send({ replies });
  }
);

//API 9 GET

app.get("/user/tweets/", authenticationToken, async (request, response) => {
  const getAllTweetsQuery = `SELECT 
    tweet.tweet,
    COUNT(distinct like.like_id) AS likes,
    COUNT(distinct reply.reply_id) AS replies,
    tweet.date_time
    FROM 
    tweet LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id = (SELECT user_id FROM user WHERE username = '${request.username}' )
    GROUP BY tweet.tweet_id
    `;
  const tweets = await db.all(getAllTweetsQuery);
  response.send(
    tweets.map((item) => {
      const { date_time, ...rest } = item;
      return {
        ...rest,
        dateTime: date_time,
      };
    })
  );
});

//API 10 POST

app.post("/user/tweets/", authenticationToken, async (request, response) => {
  const { tweet } = request.body;
  const { user_id } = await db.get(
    `SELECT user_id FROM user WHERE username = '${request.username}' `
  );
  await db.run(
    `INSERT INTO 
        tweet (tweet, user_id)
        VALUES('${tweet}', ${user_id})
        `
  );

  response.send("Created a Tweet");
});

//API 11 DELETE

app.delete(
  "/tweets/:tweetId/",
  authenticationToken,
  async (request, response) => {
    const { tweetId } = request.params;

    const userTweet = await db.get(`SELECT tweet_id, user_id
    FROM tweet 
    WHERE tweet_id = ${tweetId}
    and user_id = (SELECT user_id FROM user WHERE username = '${request.username}')
    `);

    if (userTweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      await db.run(`
            DELETE FROM tweet
            WHERE tweet_id = ${tweetId}
        `);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
