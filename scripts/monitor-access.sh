#!/bin/bash
# vLLM Studio Access Monitor
# Usage: ./monitor-access.sh [--all|--blocked|--chat|--ips|--countries|--summary]

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

FRONTEND_CONTAINER="vllm-studio-frontend"
BACKEND_LOG="/tmp/vllm-studio-backend.log"

print_header() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  vLLM Studio Access Monitor${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Real-time unified log stream
stream_all() {
    print_header
    echo -e "${GREEN}Streaming all access logs (Ctrl+C to stop)...${NC}\n"

    # Combine both log streams
    (
        docker logs -f "$FRONTEND_CONTAINER" 2>&1 | sed 's/^/[FE] /' &
        tail -f "$BACKEND_LOG" 2>/dev/null | grep --line-buffered "ACCESS" | sed 's/^/[BE] /' &
        wait
    ) | while read -r line; do
        if echo "$line" | grep -qE "blocked=True|auth=invalid|ERROR"; then
            echo -e "${RED}$line${NC}"
        elif echo "$line" | grep -qE "\[CHAT\]"; then
            echo -e "${YELLOW}$line${NC}"
        else
            echo "$line"
        fi
    done
}

# Show only blocked/suspicious requests
stream_blocked() {
    print_header
    echo -e "${RED}Watching for blocked/unauthorized requests...${NC}\n"

    (
        docker logs -f "$FRONTEND_CONTAINER" 2>&1 &
        tail -f "$BACKEND_LOG" 2>/dev/null &
        wait
    ) | grep --line-buffered -E "blocked=True|auth=invalid|status=401|status=403|ERROR"
}

# Show chat API usage
stream_chat() {
    print_header
    echo -e "${YELLOW}Watching chat API usage...${NC}\n"

    docker logs -f "$FRONTEND_CONTAINER" 2>&1 | grep --line-buffered "\[CHAT\]"
}

# Show unique IPs
show_ips() {
    print_header
    echo -e "${GREEN}Unique IPs (last 1000 log lines):${NC}\n"

    echo "=== Frontend ==="
    docker logs "$FRONTEND_CONTAINER" 2>&1 | tail -1000 | grep -oE "ip=[0-9.]+" | sed 's/ip=//' | sort -u | while read ip; do
        count=$(docker logs "$FRONTEND_CONTAINER" 2>&1 | grep -c "ip=$ip")
        echo "  $ip ($count requests)"
    done

    echo -e "\n=== Backend ==="
    tail -1000 "$BACKEND_LOG" 2>/dev/null | grep -oE "ip=[0-9.]+" | sed 's/ip=//' | sort -u | while read ip; do
        count=$(grep -c "ip=$ip" "$BACKEND_LOG" 2>/dev/null || echo 0)
        echo "  $ip ($count requests)"
    done
}

# Show countries
show_countries() {
    print_header
    echo -e "${GREEN}Requests by country (last 1000 log lines):${NC}\n"

    docker logs "$FRONTEND_CONTAINER" 2>&1 | tail -1000 | \
        grep -oE "country=[A-Z-]+" | sed 's/country=//' | \
        sort | uniq -c | sort -rn | head -20
}

# Show summary
show_summary() {
    print_header
    echo -e "${GREEN}Access Summary:${NC}\n"

    # Frontend stats
    total_fe=$(docker logs "$FRONTEND_CONTAINER" 2>&1 | grep -c "ACCESS" || echo 0)
    chat_reqs=$(docker logs "$FRONTEND_CONTAINER" 2>&1 | grep -c "\[CHAT\]" || echo 0)
    proxy_reqs=$(docker logs "$FRONTEND_CONTAINER" 2>&1 | grep -c "\[PROXY\]" || echo 0)

    # Backend stats
    total_be=$(grep -c "ACCESS" "$BACKEND_LOG" 2>/dev/null || echo 0)
    blocked=$(grep -c "blocked=True" "$BACKEND_LOG" 2>/dev/null || echo 0)
    auth_invalid=$(grep -c "auth=invalid" "$BACKEND_LOG" 2>/dev/null || echo 0)

    echo "Frontend:"
    echo "  Total requests:  $total_fe"
    echo "  Chat API calls:  $chat_reqs"
    echo "  Proxy requests:  $proxy_reqs"
    echo ""
    echo "Backend:"
    echo "  Total requests:  $total_be"
    echo -e "  Blocked:         ${RED}$blocked${NC}"
    echo -e "  Invalid auth:    ${RED}$auth_invalid${NC}"
    echo ""
    echo "Top 5 IPs:"
    docker logs "$FRONTEND_CONTAINER" 2>&1 | grep -oE "ip=[0-9.]+" | sed 's/ip=//' | sort | uniq -c | sort -rn | head -5 | while read count ip; do
        echo "  $ip: $count requests"
    done
    echo ""
    echo "Top 5 Countries:"
    docker logs "$FRONTEND_CONTAINER" 2>&1 | grep -oE "country=[A-Z-]+" | sed 's/country=//' | sort | uniq -c | sort -rn | head -5
}

# Main
case "${1:-}" in
    --blocked|-b)
        stream_blocked
        ;;
    --chat|-c)
        stream_chat
        ;;
    --ips|-i)
        show_ips
        ;;
    --countries|-C)
        show_countries
        ;;
    --summary|-s)
        show_summary
        ;;
    --all|-a|"")
        stream_all
        ;;
    *)
        echo "Usage: $0 [option]"
        echo ""
        echo "Options:"
        echo "  --all, -a       Stream all logs (default)"
        echo "  --blocked, -b   Watch blocked/unauthorized only"
        echo "  --chat, -c      Watch chat API usage"
        echo "  --ips, -i       Show unique IPs"
        echo "  --countries, -C Show requests by country"
        echo "  --summary, -s   Show access summary"
        ;;
esac
