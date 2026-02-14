VAR TEST = 10
CONST TESTC = 20

~ TEST += 1
~ temp BOO=7

-> Main1

=== Main1
This is Main 1
-> TunnelTest1 ->
-> TunnelTest2 ->
-> DONE

=== Main2
This is Main 2
~ Fred()
-> DONE

=== function Fred()
~ return

== TunnelTest1
Tunnelling1
->->

== TunnelTest2
Tunnelling2
->->

== thread_example ==
I had a headache; threading is hard to get your head around.
<- conversation
<- walking

== conversation ==
It was a tense moment for Monty and me.
 * "What did you have for lunch today?"[] I asked.
    "Spam and eggs," he replied.
 * "Nice weather, we're having,"[] I said.
    "I've seen better," he replied.
 - -> house

== walking ==
We continued to walk down the dusty road.
 * [Continue walking]
    -> house

== house ==
Before long, we arrived at his house.
-> END

EXTERNAL ExFunctionTestNoFallback(soundName)
EXTERNAL ExFunctionTestWithFallback(soundName)
=== function ExFunctionTestWithFallback(soundName)
This is a fallback for external function, passed ({soundName})
~ return

== TestExternalFunctions
= NoFallback
~ ExFunctionTestNoFallback("Test")
-> DONE

= WithFallback
~ ExFunctionTestWithFallback("Test")
-> DONE