import { useState } from "react";
import { render, Text, useApp, useInput } from "ink";

function Probe() {
  const { exit } = useApp();
  const [last, setLast] = useState(
    "按 Enter / Shift+Enter / Alt+Enter / Ctrl+J；按 q 退出",
  );

  useInput((input, key) => {
    if (input === "q") {
      exit();
    }
    setLast(
      JSON.stringify({
        input: JSON.stringify(input),
        return: key.return,
        shift: key.shift,
        meta: key.meta,
        ctrl: key.ctrl,
      }),
    );
  });

  return <Text>{last}</Text>;
}

render(<Probe />, {
  kittyKeyboard: {
    mode: "auto",
    flags: ["disambiguateEscapeCodes"],
  },
});
