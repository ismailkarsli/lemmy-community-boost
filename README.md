# Lemmy Community Boost

LCB is a tool to "seed" beginner communities in the [Lemmyverse](https://join-lemmy.org).

The purpose: Communities in Lemmy are only federated if a user is subscribes to them from external instance. This means that new communities are not visible to external instance users. To fix that, LCB automatically subscribes to new communities from external instances to make them federated.

Why: I think mods (including me) wouldn't to put effort into a new community if it doesn't get any interaction, so I think it would be nice to at least start with it appearing in the "All" tab.

How: LCB automatically subscribes to communities from external instances until a normal user subscribes too. Then it will unsubscribe to not manipulate the community's subscriber count. Also it does not allow instances that are not guaranteed by Fediseer or are NSFW. (pls note that in version 0.19, it will unsubscribe after a month instead because of this issue: <https://github.com/LemmyNet/lemmy/issues/4144>)

If you are an instance admin, the instances and users used are listed below. If you want to add or remove a user from this tool, you can contact me.

Contact me from lemmy: [@iso@lemy.lol](https://lemy.lol/u/iso) or email: iso{at}lemy.lol
