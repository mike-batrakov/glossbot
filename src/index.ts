import { Probot } from "probot";
import { handleTrack } from "./handlers/track";

export default (app: Probot): void => {
  app.on("pull_request_review_comment.created", async (context) => {
    await handleTrack(context, "pull_request_review_comment");
  });

  app.on("issue_comment.created", async (context) => {
    if (context.payload.issue.pull_request === undefined) {
      return;
    }

    await handleTrack(context, "issue_comment");
  });

  app.log.info("GlossBot loaded");
};
