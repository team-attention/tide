#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "$0")/.." && pwd -P)
integration_dir="$repo_dir/crates/tide-app/resources/shell-integration"
fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/shell-state.XXXXXX")
cleanup() {
    if [[ "${TIDE_KEEP_SHELL_FIXTURE:-0}" == 1 ]]; then
        printf 'Kept shell fixture: %s\n' "$fixture_root" >&2
    else
        rm -rf "$fixture_root"
    fi
}
trap cleanup EXIT

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

assert_count() {
    local expected=$1 pattern=$2 file=$3
    local actual
    actual=$(grep -Fxc "$pattern" "$file" 2>/dev/null || true)
    [[ "$actual" == "$expected" ]] || fail "$file: expected $expected occurrences of $pattern, got $actual"
}

assert_capture() {
    local pattern=$1 file=$2
    LC_ALL=C grep -aFq "$pattern" "$file" || fail "$file: missing $(printf %q "$pattern")"
}

assert_bash_command_protocol() {
    local capture=$1 nonce=$2 hook_log=$3
    CHECK_NONCE="$nonce" perl -0ne '
        my $nonce = $ENV{CHECK_NONCE};
        my $a = "\e]133;A;tide_nonce=$nonce\e\\";
        my $b = "\e]133;B;tide_nonce=$nonce\e\\";
        my $c = "\e]133;C;tide_nonce=$nonce\e\\";
        my $first_prompt = index($_, "PROMPT_MARK> ");
        die "missing first prompt\n" if $first_prompt < 0;

        my $before = substr($_, 0, $first_prompt);
        my $after = substr($_, $first_prompt);
        my $before_count = () = $before =~ /\Q$c\E/g;
        my $after_count = () = $after =~ /\Q$c\E/g;
        die "expected no Bash C boundaries before first prompt, got $before_count\n"
            if $before_count != 0;
        die "expected 13 Bash C boundaries after first prompt, got $after_count\n"
            if $after_count != 13;

        my @starts;
        while ($_ =~ /\Q$b\E/g) { push @starts, pos($_); }
        my @expected = (1, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1);
        die "expected 16 Bash prompt segments, got " . scalar(@starts) . "\n"
            if @starts != @expected;
        for my $index (0 .. $#starts) {
            my $end = $index == $#starts ? length($_) : $starts[$index + 1];
            my $segment = substr($_, $starts[$index], $end - $starts[$index]);
            my $count = () = $segment =~ /\Q$c\E/g;
            die "Bash prompt segment $index expected $expected[$index] C boundaries, got $count\n"
                if $count != $expected[$index];
        }

        my $a_count = () = /\Q$a\E/g;
        die "expected 16 Bash A boundaries, got $a_count\n" if $a_count != 16;

        my $cd_output = index($_, "CD_OK:");
        my $encoded_cwd = index($_, "%20%C3%BC%3Bdir?tide_nonce=$nonce");
        die "compound cd CWD signal did not precede following command output\n"
            if $cd_output < 0 || $encoded_cwd < 0 || $encoded_cwd > $cd_output;
    ' "$capture" || fail "bash: command lifecycle protocol mismatch"

    local boundary_statuses prompt_statuses
    boundary_statuses=$(CHECK_NONCE="$nonce" perl -0ne '
        my $nonce = $ENV{CHECK_NONCE};
        my @statuses = /\e\]133;D;([^;]*);tide_nonce=\Q$nonce\E\e\\/g;
        print join(",", @statuses);
    ' "$capture")
    prompt_statuses=$(sed -n 's/^user-prompt://p' "$hook_log" | paste -sd, -)
    [[ "$boundary_statuses" == "$prompt_statuses" ]] || fail "bash: D statuses ($boundary_statuses) differ from user PROMPT_COMMAND statuses ($prompt_statuses)"
}

assert_zsh_command_protocol() {
    local capture=$1 nonce=$2 hook_log=$3
    CHECK_NONCE="$nonce" perl -0ne '
        my $nonce = $ENV{CHECK_NONCE};
        my $b = "\e]133;B;tide_nonce=$nonce\e\\";
        my $c = "\e]133;C;tide_nonce=$nonce\e\\";
        my @starts;
        while ($_ =~ /\Q$b\E/g) { push @starts, pos($_); }
        my @expected = (1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1);
        die "expected 15 zsh prompt segments, got " . scalar(@starts) . "\n"
            if @starts != @expected;
        for my $index (0 .. $#starts) {
            my $end = $index == $#starts ? length($_) : $starts[$index + 1];
            my $segment = substr($_, $starts[$index], $end - $starts[$index]);
            my $count = () = $segment =~ /\Q$c\E/g;
            die "zsh prompt segment $index expected $expected[$index] C boundaries, got $count\n"
                if $count != $expected[$index];
        }
        my @statuses = /\e\]133;D;([^;]*);tide_nonce=\Q$nonce\E\e\\/g;
        my $actual = join(",", @statuses);
        my $expected_statuses = "0,0,0,0,0,0,1,1,0,0,0,0,0,0,130";
        die "zsh D statuses $actual differ from $expected_statuses\n"
            if $actual ne $expected_statuses;
    ' "$capture" || fail "zsh: command lifecycle protocol mismatch"

    local boundary_statuses prompt_statuses
    boundary_statuses=$(CHECK_NONCE="$nonce" perl -0ne '
        my $nonce = $ENV{CHECK_NONCE};
        my @statuses = /\e\]133;D;([^;]*);tide_nonce=\Q$nonce\E\e\\/g;
        print join(",", @statuses);
    ' "$capture")
    prompt_statuses=$(sed -n 's/^user-prompt://p' "$hook_log" | paste -sd, -)
    [[ "$boundary_statuses" == "$prompt_statuses" ]] || fail "zsh: D statuses differ from user precmd statuses"
}

assert_fish_command_protocol() {
    local capture=$1 nonce=$2 hook_log=$3
    local protocol
    protocol=$(CHECK_NONCE="$nonce" perl -0ne '
        my $nonce = $ENV{CHECK_NONCE};
        while (/\e\]133;(C|D)(?:;[^;]*)?;tide_nonce=\Q$nonce\E\e\\/g) {
            print $1;
        }
    ' "$capture")
    [[ "$protocol" == "DCDCDCDCDCDCDCDCDCDCDCDCDC" ]] || fail "fish: unexpected C/D lifecycle order $protocol"

    local boundary_statuses postexec_statuses
    boundary_statuses=$(CHECK_NONCE="$nonce" perl -0ne '
        my $nonce = $ENV{CHECK_NONCE};
        my @statuses = /\e\]133;D;([^;]*);tide_nonce=\Q$nonce\E\e\\/g;
        shift @statuses;
        print join(",", @statuses);
    ' "$capture")
    postexec_statuses=$(sed -n 's/^user-postexec:.*:\([0-9][0-9]*\)$/\1/p' "$hook_log" | paste -sd, -)
    [[ "$boundary_statuses" == "$postexec_statuses" ]] || fail "fish: D statuses ($boundary_statuses) differ from user postexec statuses ($postexec_statuses)"
}

cat >"$fixture_root/drive.exp" <<'EXPECT'
set timeout 20
set kind [lindex $argv 0]
set program [lindex $argv 1]
set home [lindex $argv 2]
set integration [lindex $argv 3]
set capture [lindex $argv 4]
set nonce [lindex $argv 5]
set hook_log [lindex $argv 6]
set prompt "PROMPT_MARK> "
set prompt_start "\033\]133;A;tide_nonce=$nonce\033\\"
set command_start "\033\]133;C;tide_nonce=$nonce\033\\"
set command_finished [format {\x1b\]133;D;[^;]*;tide_nonce=%s\x1b\\} $nonce]

log_user 0

set common [list /usr/bin/env -u HOSTNAME -u HOST "TERM=xterm-256color" "SHELL=$program" "TIDE_TEST_HOOK_LOG=$hook_log" "TIDE_TEST_RECORD_DEBUG=1"]
if {$kind eq "zsh"} {
    set command [concat $common [list "HOME=$home" "ZDOTDIR=$integration" "TIDE_TERMINAL_SHELL_INTEGRATION_DIR=$integration" "__TIDE_TERMINAL_ORIG_ZDOTDIR=$home" "__TIDE_TERMINAL_SHELL_NONCE=$nonce" $program --login]]
} elseif {$kind eq "bash"} {
    set command [concat $common [list "HOME=$integration" "TIDE_TERMINAL_SHELL_INTEGRATION_DIR=$integration" "__TIDE_TERMINAL_ORIG_HOME=$home" "__TIDE_TERMINAL_SHELL_NONCE=$nonce" $program --login]]
} elseif {$kind eq "bash-baseline"} {
    set command [concat $common [list "HOME=$home" $program --login]]
} else {
    set init "set -g __tide_terminal_nonce '$nonce'; source '$integration/config.fish'"
    set command [concat $common [list "HOME=$home" $program --login --init-command $init]]
}

cd $home
spawn {*}$command
log_file -a -noappend $capture
expect -exact $prompt
send -- "stty -echo\r"
if {$kind ne "bash-baseline"} {
    expect -re $command_finished
    expect -exact $prompt_start
}
expect -exact $prompt

proc run_command {command prompt} {
    global command_finished kind prompt_start
    send -- "$command\r"
    if {$kind ne "bash-baseline"} {
        expect -re $command_finished
        expect -exact $prompt_start
    }
    expect -exact $prompt
}

if {$kind eq "zsh"} {
    run_command {if [[ -o login ]]; then printf 'LOGIN_OK:yes\n'; else printf 'LOGIN_OK:no\n'; fi} $prompt
    run_command {if env | grep -Eq '^(__TIDE_TERMINAL_SHELL_NONCE|TIDE_TERMINAL_SHELL_INTEGRATION_DIR)='; then printf 'ENV_LEAK\n'; else printf 'ENV_CLEAN\n'; fi} $prompt
    run_command {printf 'HOOK_PROBE\n'} $prompt
    run_command {} $prompt
    run_command {false} $prompt
    run_command {)} $prompt
    run_command {printf 'PIPELINE_OK\n' | cat} $prompt
    run_command {function tide_test_fn { printf 'FUNCTION_OK\n'; }} $prompt
    run_command {tide_test_fn} $prompt
    run_command {sleep 0.01 & wait; printf 'BACKGROUND_OK\n'} $prompt
    run_command {mkdir -p 'space ü;dir'; cd 'space ü;dir' && printf 'CD_OK:%s\n' "$PWD"} $prompt
    run_command {printf 'NESTED_BEGIN'; TIDE_TEST_HOOK_LOG=/dev/null "$SHELL" -i -c 'printf nested-ok'; printf 'NESTED_END\n'} $prompt
} elseif {$kind eq "bash" || $kind eq "bash-baseline"} {
    run_command {if shopt -q login_shell; then printf 'LOGIN_OK:yes\n'; else printf 'LOGIN_OK:no\n'; fi} $prompt
    run_command {printf 'ZERO:%s\n' "$0"} $prompt
    run_command {if env | grep -Eq '^(__TIDE_TERMINAL_SHELL_NONCE|TIDE_TERMINAL_SHELL_INTEGRATION_DIR)='; then printf 'ENV_LEAK\n'; else printf 'ENV_CLEAN\n'; fi} $prompt
    run_command {printf 'HOOK_PROBE\n'} $prompt
    run_command {} $prompt
    run_command {false} $prompt
    run_command {)} $prompt
    run_command {printf 'PIPELINE_OK\n' | cat} $prompt
    run_command {function tide_test_fn { printf 'FUNCTION_OK\n'; }} $prompt
    run_command {tide_test_fn} $prompt
    run_command {sleep 0.01 & wait; printf 'BACKGROUND_OK\n'} $prompt
    run_command {mkdir -p 'space ü;dir'; cd 'space ü;dir' && printf 'CD_OK:%s\n' "$PWD"} $prompt
    run_command {printf 'NESTED_BEGIN'; TIDE_TEST_HOOK_LOG=/dev/null "$SHELL" -i -c 'printf nested-ok'; printf 'NESTED_END\n'} $prompt
} else {
    run_command {if status is-login; echo 'LOGIN_OK:yes'; else; echo 'LOGIN_OK:no'; end} $prompt
    run_command {if env | string match -qr '^__TIDE_TERMINAL_SHELL_NONCE='; echo ENV_LEAK; else; echo ENV_CLEAN; end} $prompt
    run_command {printf 'HOOK_PROBE\n'} $prompt
    run_command {} $prompt
    run_command {false} $prompt
    send -- "echo )\r"
    expect -re $command_finished
    expect -exact $prompt_start
    expect -exact $prompt
    send -- "\025\r"
    expect -re $command_finished
    expect -exact $prompt_start
    expect -exact $prompt
    run_command {printf 'PIPELINE_OK\n' | cat} $prompt
    run_command {function tide_test_fn; printf 'FUNCTION_OK\n'; end} $prompt
    run_command {tide_test_fn} $prompt
    run_command {sleep 0.01 &; wait; printf 'BACKGROUND_OK\n'} $prompt
    run_command {mkdir -p 'space ü;dir'; cd 'space ü;dir'; and printf 'CD_OK:%s\n' "$PWD"} $prompt
    run_command {printf 'NESTED_BEGIN'; env -u TIDE_TEST_HOOK_LOG "$SHELL" -i -c 'printf nested-ok'; printf 'NESTED_END\n'} $prompt
}

send -- "sleep 5\r"
if {$kind ne "bash-baseline"} {
    expect -exact $command_start
}
after 150
send -- "\003"
if {$kind ne "bash-baseline"} {
    expect -re $command_finished
    expect -exact $prompt_start
}
expect -exact $prompt
send -- "exec /usr/bin/printf 'EXEC_OK\\n'\r"
expect eof
EXPECT

make_zsh_fixture() {
    local home=$1
    cat >"$home/.zshenv" <<'EOF'
print -r -- startup:zshenv >>"$TIDE_TEST_HOOK_LOG"
EOF
    cat >"$home/.zprofile" <<'EOF'
print -r -- startup:zprofile >>"$TIDE_TEST_HOOK_LOG"
EOF
    cat >"$home/.zshrc" <<'EOF'
print -r -- startup:zshrc >>"$TIDE_TEST_HOOK_LOG"
autoload -Uz add-zsh-hook
_tide_test_user_precmd() { local command_status=$?; print -r -- "user-prompt:$command_status" >>"$TIDE_TEST_HOOK_LOG"; return "$command_status"; }
_tide_test_user_preexec() { print -r -- "user-preexec:$1" >>"$TIDE_TEST_HOOK_LOG"; }
_tide_test_user_chpwd() { print -r -- "user-chpwd:$PWD" >>"$TIDE_TEST_HOOK_LOG"; }
add-zsh-hook precmd _tide_test_user_precmd
add-zsh-hook preexec _tide_test_user_preexec
add-zsh-hook chpwd _tide_test_user_chpwd
PROMPT='PROMPT_MARK> '
EOF
    cat >"$home/.zlogin" <<'EOF'
print -r -- startup:zlogin >>"$TIDE_TEST_HOOK_LOG"
EOF
}

make_bash_fixture() {
    local home=$1
    cat >"$home/.bash_profile" <<'EOF'
printf '%s\n' startup:bash_profile >>"$TIDE_TEST_HOOK_LOG"
PS1='PROMPT_MARK> '
_tide_test_user_prompt() { printf 'user-prompt:%s\n' "$?" >>"$TIDE_TEST_HOOK_LOG"; }
PROMPT_COMMAND=_tide_test_user_prompt
trap 'case "$BASH_COMMAND" in _tide_terminal_*|_tide_test_user_prompt) ;; *) if [ "${TIDE_TEST_RECORD_DEBUG:-0}" = 1 ]; then printf "user-preexec:%s:%s\n" "$?" "$BASH_COMMAND" >>"$TIDE_TEST_HOOK_LOG"; fi ;; esac' DEBUG
EOF
    printf '%s\n' 'printf startup:bash_login >>"$TIDE_TEST_HOOK_LOG"' >"$home/.bash_login"
    printf '%s\n' 'printf startup:profile >>"$TIDE_TEST_HOOK_LOG"' >"$home/.profile"
}

make_fish_fixture() {
    local home=$1
    mkdir -p "$home/.config/fish"
    cat >"$home/.config/fish/config.fish" <<'EOF'
if set -q TIDE_TEST_HOOK_LOG
    echo startup:fish_config >>"$TIDE_TEST_HOOK_LOG"
end
function fish_prompt
    set -l command_status $status
    if set -q TIDE_TEST_HOOK_LOG
        echo "user-prompt:$command_status" >>"$TIDE_TEST_HOOK_LOG"
    end
    printf 'PROMPT_MARK> '
    return $command_status
end
function _tide_test_user_preexec --on-event fish_preexec
    if set -q TIDE_TEST_HOOK_LOG
        echo "user-preexec:$argv" >>"$TIDE_TEST_HOOK_LOG"
    end
end
function _tide_test_user_postexec --on-event fish_postexec
    set -l command_status $status
    if set -q TIDE_TEST_HOOK_LOG
        echo "user-postexec:$argv:$command_status" >>"$TIDE_TEST_HOOK_LOG"
    end
    return $command_status
end
EOF
}

run_bash_baseline() {
    local home="$fixture_root/bash-baseline-home"
    mkdir -p "$home"
    : >"$fixture_root/bash-baseline.hooks"
    make_bash_fixture "$home"
    /usr/bin/expect "$fixture_root/drive.exp" bash-baseline /bin/bash "$home" "$integration_dir" "$fixture_root/bash-baseline.capture" unused "$fixture_root/bash-baseline.hooks"
}

verify_case() {
    local kind=$1 program=$2 home="$fixture_root/$1-home"
    local capture="$fixture_root/$1.capture" hook_log="$fixture_root/$1.hooks"
    local nonce="nonce-$1-7f3b"
    mkdir -p "$home"
    : >"$hook_log"

    "make_${kind}_fixture" "$home"
    /usr/bin/expect "$fixture_root/drive.exp" "$kind" "$program" "$home" "$integration_dir" "$capture" "$nonce" "$hook_log"

    assert_capture 'LOGIN_OK:yes' "$capture"
    if [[ "$kind" == bash ]]; then
        assert_capture 'ZERO:' "$capture"
    fi
    assert_capture 'ENV_CLEAN' "$capture"
    assert_capture 'HOOK_PROBE' "$capture"
    assert_capture 'PIPELINE_OK' "$capture"
    assert_capture 'FUNCTION_OK' "$capture"
    assert_capture 'BACKGROUND_OK' "$capture"
    assert_capture 'CD_OK:' "$capture"
    assert_capture '%20%C3%BC%3Bdir' "$capture"
    assert_capture 'NESTED_BEGINnested-okNESTED_END' "$capture"
    assert_capture 'EXEC_OK' "$capture"

    local esc=$'\033' st=$'\033\\'
    assert_capture "${esc}]7;file://$(hostname)" "$capture"
    for boundary in A B C D; do
        assert_capture "${esc}]133;${boundary}" "$capture"
    done
    assert_capture "tide_nonce=${nonce}${st}" "$capture"

    if [[ "$kind" == bash ]]; then
        assert_bash_command_protocol "$capture" "$nonce" "$hook_log"
    elif [[ "$kind" == zsh ]]; then
        assert_zsh_command_protocol "$capture" "$nonce" "$hook_log"
    else
        assert_fish_command_protocol "$capture" "$nonce" "$hook_log"
    fi

    perl -0ne 'if (/NESTED_BEGIN(.*?)NESTED_END/s && $1 =~ /tide_nonce/) { exit 1 }' "$capture" || fail "$kind: nested shell emitted Tide boundaries"
    perl -0pe 's/\e\][^\a]*(?:\a|\e\\)//gs; s/\e\[[0-9;?]*[ -\/]*[@-~]//g' "$capture" >"$capture.visible"
    if grep -aiq 'tide' "$capture.visible"; then
        fail "$kind: Tide text leaked into visible output"
    fi

    case "$kind" in
        zsh)
            assert_count 1 startup:zshenv "$hook_log"
            assert_count 1 startup:zprofile "$hook_log"
            assert_count 1 startup:zshrc "$hook_log"
            assert_count 1 startup:zlogin "$hook_log"
            [[ $(grep -Fc user-chpwd: "$hook_log") == 1 ]] || fail "zsh: user chpwd hook did not run exactly once"
            ;;
        bash)
            assert_count 1 startup:bash_profile "$hook_log"
            assert_count 0 startup:bash_login "$hook_log"
            assert_count 0 startup:profile "$hook_log"
            assert_count 1 startup:bash_profile "$fixture_root/bash-baseline.hooks"
            assert_count 0 startup:bash_login "$fixture_root/bash-baseline.hooks"
            assert_count 0 startup:profile "$fixture_root/bash-baseline.hooks"

            local integrated_zero baseline_zero
            integrated_zero=$(LC_ALL=C grep -ao 'ZERO:[^[:cntrl:]]*' "$capture" | head -1)
            baseline_zero=$(LC_ALL=C grep -ao 'ZERO:[^[:cntrl:]]*' "$fixture_root/bash-baseline.capture" | head -1)
            [[ "$integrated_zero" == "$baseline_zero" ]] || fail "bash: \$0 differs from baseline ($integrated_zero vs $baseline_zero)"

            diff -u <(grep '^user-preexec:' "$fixture_root/bash-baseline.hooks") <(grep '^user-preexec:' "$hook_log") || fail "bash: user DEBUG callbacks differ from baseline"
            diff -u <(grep '^user-prompt:' "$fixture_root/bash-baseline.hooks") <(grep '^user-prompt:' "$hook_log") || fail "bash: user PROMPT_COMMAND statuses differ from baseline"
            [[ $(grep -c '^user-preexec:' "$hook_log") == 23 ]] || fail "bash: expected 23 DEBUG callbacks matching baseline"
            local integrated_prompts baseline_prompts
            integrated_prompts=$(LC_ALL=C grep -aoF 'PROMPT_MARK> ' "$capture" | wc -l | tr -d ' ')
            baseline_prompts=$(LC_ALL=C grep -aoF 'PROMPT_MARK> ' "$fixture_root/bash-baseline.capture" | wc -l | tr -d ' ')
            [[ "$integrated_prompts" == "$baseline_prompts" ]] || fail "bash: rendered prompt count differs from baseline ($integrated_prompts vs $baseline_prompts)"
            ;;
        fish)
            assert_count 1 startup:fish_config "$hook_log"
            assert_count 1 "user-postexec:printf 'HOOK_PROBE\\n':0" "$hook_log"
            ;;
    esac

    if [[ "$kind" == bash ]]; then
        assert_count 1 "user-preexec:0:printf 'HOOK_PROBE\\n'" "$hook_log"
    else
        assert_count 1 "user-preexec:printf 'HOOK_PROBE\\n'" "$hook_log"
    fi
    local prompt_hooks prompt_signals rendered_prompts
    prompt_hooks=$(grep -Fc user-prompt "$hook_log")
    prompt_signals=$(LC_ALL=C grep -aoF "${esc}]133;A;tide_nonce=${nonce}${st}" "$capture" | wc -l | tr -d ' ')
    rendered_prompts=$(LC_ALL=C grep -aoF 'PROMPT_MARK> ' "$capture" | wc -l | tr -d ' ')
    [[ "$rendered_prompts" == "$prompt_signals" ]] || fail "$kind: rendered prompts ($rendered_prompts) and Tide prompt signals ($prompt_signals) differ"
    if [[ "$kind" == fish ]]; then
        # Fish may evaluate fish_prompt once during startup capability setup
        # without rendering it; every rendered prompt must still call it once.
        [[ "$prompt_hooks" == "$prompt_signals" || "$prompt_hooks" == "$((prompt_signals + 1))" ]] || fail "$kind: unexpected user prompt hook count $prompt_hooks for $prompt_signals rendered prompts"
    else
        [[ "$prompt_hooks" == "$prompt_signals" ]] || fail "$kind: user prompt hooks ($prompt_hooks) and Tide prompt signals ($prompt_signals) differ"
    fi

    printf 'PASS: %s\n' "$kind"
}

for required in /bin/zsh /bin/bash /opt/homebrew/bin/fish; do
    [[ -x "$required" ]] || fail "required shell is missing: $required"
done

verify_case zsh /bin/zsh
run_bash_baseline
verify_case bash /bin/bash
verify_case fish /opt/homebrew/bin/fish
