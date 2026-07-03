# Star Transcription Is Not Account Transcription

The better shape for Whispering is not "account transcription." It is star
transcription: transcribe through the Epicenter deployment this install is
connected to. Hosted cloud can meter that call with credits. Self-host can proxy
it through the operator's house key. The provider should name the relationship to
the backend, not one billing policy that only exists on hosted cloud.

The product sentence gets much shorter:

```txt
Whispering can transcribe through the Epicenter star it is connected to.
Hosted stars meter usage. Self-host stars proxy through the operator's house key.
```

That sentence is doing useful work. It separates the provider from the payment
model, which means the UI does not need to ask whether the current star is
hosted or self-hosted before deciding whether the provider is real.

Here is the shape we want:

```txt
                         Whispering
                             |
               selected transcription provider
                             |
        +---------+----------+-----------+----------+
        |         |                      |          |
      local      byok                endpoint      star
        |         |                      |          |
   on device   user's key        user's service    Epicenter deployment
                                                hosted or self-host
                                                       |
                                    +------------------+------------------+
                                    |                                     |
                              hosted cloud                          self-host
                                    |                                     |
                         /v1/audio mounted                    /v1/audio mounted
                         Autumn meters it                     no Autumn policy
                         credits can 402                      house key pays
```

The important move is that `star` is one provider family. It does not split into
`hostedAccount` and `selfHostGateway`. Those names would preserve the accident.
Both deployables expose the same OpenAI-compatible `/v1/audio/transcriptions`
gateway; they differ in the middleware around it.

Hosted cloud wraps the gateway in auth and Autumn metering:

```txt
hosted star
  -> session auth
  -> credit policy
  -> /v1/audio/transcriptions
  -> provider house key
```

Self-host wraps the same gateway in instance bearer auth and no Autumn policy:

```txt
self-host star
  -> instance bearer auth
  -> rate limit
  -> /v1/audio/transcriptions
  -> operator house key
```

Same wire. Same client path. Different deployment policy.

This is where the old `account` name was misleading. It quietly fused two facts
that only travel together on hosted cloud:

```txt
account
  = identity + wallet on hosted Epicenter
  + authenticated access to the star's house-key gateway
```

Only the second part generalizes. A self-host instance does not have hosted
Epicenter accounts or Autumn credits, but it still has a star: the deployment the
client is bonded to. It still has authenticated access. It can still hold a house
key and proxy the transcription request.

So the provider should name the thing that survives both deployables:

```txt
byok:
  user supplies a provider key

endpoint:
  user supplies a service URL, such as Speaches

star:
  user is authenticated to the Epicenter deployment they are already using

local:
  no network, no credential, just the device
```

That taxonomy is not just prettier. It deletes a branch.

The tempting fix would have been to keep `account` and add hosted/self-host
visibility logic:

```txt
if hosted:
  show Epicenter account transcription
  spend credits

if self-host:
  hide Epicenter account transcription
  or show it but special-case the copy
  or let it 404 and explain the failure
```

That path makes hosted-ness a UI concern. Once that branch exists, it leaks into
provider readiness, labels, tests, empty states, and docs. The provider selector
starts answering a deployment question it should not own.

The cleaner fix is to make the invariant true:

```txt
always:
  show star transcription
  call the star's /v1/audio/transcriptions route
  let the deployment decide billing

hosted:
  Autumn may return 402 InsufficientCredits

self-host:
  no Autumn policy
  missing house key returns 503 ProviderNotConfigured
```

Now the decision tree is smaller because the server owns the deployment
difference. The client owns provider selection. Billing is just middleware on
one deployable.

This is an asymmetric win, but not because it deletes a huge number of lines
today. The win is that it refuses the wrong product promise before it becomes a
permanent shape.

The refused promise is:

```txt
Epicenter transcription means hosted account wallet transcription.
```

The kept promise is:

```txt
Epicenter transcription means transcription through your connected star.
```

That keeps the product useful in both worlds. Hosted users get credit-metered
transcription through Epicenter cloud. Self-host operators get the same route on
their own instance, paid by their own upstream provider account. BYOK and custom
endpoints stay separate because they are separate relationships: the user brings
a key, or the user brings a service URL.

The rule I want to remember is simple:

```txt
Name the backend relationship first.
Let billing, metering, and operator cost be deployment policy.
```

When the name follows the billing accident, the code starts asking "which kind
of Epicenter is this?" in places that should not care. When the name follows the
relationship, the UI can stay flat: local, byok, endpoint, star.

That is the better shape.
