This reference guide outlines the essential syntax rules and most common commands for **ProBuilder** (the language behind ProRealTime). Whether you are using the "13th Warrior" logic or building a custom indicator, these rules are the foundation of a successful script.

---

## 1. Fundamental Syntax Rules

### The Underscore Rule (`_`)

* **The Rule:** Variable names **cannot** contain underscores (`_`).
* **Why:** ProRealTime reserves the underscore for internal system functions or older legacy code.
* **Correct:** `MyVariable = 10`, `ObvBull = 1`, `TrendUp = 1`.
* **Incorrect:** `My_Variable = 10`, `OBV_Bull = 1`, `Trend_Up = 1`.

### Case Sensitivity

* ProRealTime is **not** case-sensitive for commands. `IF`, `if`, and `If` are all treated the same. However, using "CamelCase" for variables (e.g., `TrailingStop`) is standard practice for readability.

### Reserved Words

* You cannot name a variable after a command. For example, you cannot name a variable `Open`, `High`, `Close`, `Average`, or `Buy`.

---

## 2. Logical Blocks (IF / THEN / ENDIF)

Every logical gate must be properly closed. The "Characters Missing" error is almost always caused by a missing `ENDIF`.

### Standard Styling

```prorealtime
IF [Condition] THEN
    // Execute if true
    BUY 1 CONTRACT AT MARKET
ENDIF

// Nested Blocks
IF [Condition A] THEN
    IF [Condition B] THEN
        // Both A and B are true
    ENDIF
ENDIF

```

### Complex Styling (ELSIF)

```prorealtime
IF [Condition A] THEN
    // Result A
ELSIF [Condition B] THEN
    // Result B
ELSE
    // If neither A nor B is true
ENDIF

```

---

## 3. Most Common Commands

### Execution Commands (Auto-Trading)

| Command | Usage | Example |
| --- | --- | --- |
| `BUY` | Opens a Long position. | `BUY 1 CONTRACT AT MARKET` |
| `SELLSHORT` | Opens a Short position. | `SELLSHORT 1 CONTRACT AT MARKET` |
| `SELL` | Closes a Long position. | `SELL AT MARKET` |
| `EXITSHORT` | Closes a Short position. | `EXITSHORT AT MARKET` |
| `SET STOP PLOSS` | Set a hard stop in points. | `SET STOP PLOSS 50` |
| `SET TARGET PROFIT` | Set a profit target in points. | `SET TARGET PROFIT 100` |

### Position Status

* `ONMARKET`: Returns true if a position is open.
* `LONGONMARKET`: Returns true if a long position is open.
* `SHORTONMARKET`: Returns true if a short position is open.
* `COUNTOFPOSITION`: Returns the current number of contracts open.
* `TRADEPRICE(1)`: Returns the entry price of the current trade.

### Price & Time Data

* `OPEN`, `HIGH`, `LOW`, `CLOSE`, `VOLUME`
* `[n]`: Brackets look back in time. `CLOSE[1]` is the close of the previous candle.
* `BARINDEX`: The number of the current bar since the start of the chart.
* `TIME`: Current time (HHMMSS format).

---

## 4. Common Indicators (ProBuilder)

Indicators usually take a period in square brackets `[n]` and a price source in parentheses `(price)`.

* **Moving Average:** `Average[20](close)`
* **Exponential Moving Average:** `ExponentialAverage[20](close)`
* **RSI:** `RSI[14](close)`
* **OBV:** `OBV(close)`
* **ATR:** `AverageTrueRange[14]`
* **Highest/Lowest:** `Highest[20](high)` or `Lowest[2](low[1])`

---

## 5. Styling and Optimization Tips

### Using `ONCE`

If you want to initialize a variable only on the very first bar of the chart (like a starting capital or a Heikin Ashi seed), use `ONCE`.

```prorealtime
ONCE myStartingCapital = 1000

```

### Graphing for Debugging

The `GRAPH` command is the best tool for troubleshooting. It creates a subplot on your chart so you can see the value of a variable in real-time.

```prorealtime
GRAPH ObvBull AS "OBV Signal"
GRAPH (StrategyProfit) AS "Current P/L"

```

### Comments

Use `//` to leave notes in your code. The compiler ignores anything on the line after these slashes.

---

