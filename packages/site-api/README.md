# @belle-puzzles/site-api

This package contains the azure functions implementations that are shipped with the static web app.

## idParam

The APIs used by this static web app replace more reasonable templated APIs due to an appeared limitation of node.js azure functions binding to route parameters.

In particular, it doesn't seem possible to configure the routing rools to parse a discord id as a string, and parsing as a number
loses precision (using the :long doesn't work). See [here](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/routing?view=aspnetcore-6.0#route-constraints) for possible constraints.

To work around this, rather than do e.g. `/discord/guild/:guildId/channels`, the caller should use `/discord/guild/guildId/channels?guildId=${guildId}` or place `guildId` in the body.
