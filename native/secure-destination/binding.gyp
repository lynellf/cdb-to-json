{
  "targets": [
    {
      "target_name": "secure_destination",
      "sources": [ "src/secure_destination.cc", "src/secure_destination.h" ],
      "include_dirs": [
        "src",
        "<!@(node -p \"require.resolve('node-addon-api')\" | xargs dirname)"
      ],
      "conditions": [
        ["OS=='linux'", {
          "cflags!": [ "-fno-exceptions" ],
          "cflags_cc!": [ "-fno-exceptions" ]
        }]
      ],
      "defines": [
        "NAPI_VERSION=9"
      ]
    }
  ]
}
